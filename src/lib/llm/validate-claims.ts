import 'server-only';

import { z } from 'zod';

const factId = z.string().regex(/^[a-z][a-z_]*$/);
const factSchema = z.object({
  id: factId,
  label: z.string().regex(/^[A-Za-z][A-Za-z '-]*$/),
  phrase: z.string().trim().min(1).refine((value) => !/[{}]/.test(value)),
}).strict();
const flagsSchema = z.object({
  transitServiceKnown: z.boolean(),
  transitFaster: z.boolean(),
  transitCheaper: z.boolean(),
  offerActive: z.boolean(),
  trafficNow: z.boolean(),
}).strict();
const inputSchema = z.object({
  nudge: z.string(),
  slots: z.array(factId),
  facts: z.array(factSchema),
  flags: flagsSchema,
});

export type NarrationFact = z.infer<typeof factSchema>;
export type NarrationFlags = z.infer<typeof flagsSchema>;
export type ValidationReason =
  | 'invalid_input'
  | 'empty_nudge'
  | 'digit_in_nudge'
  | 'duplicate_fact'
  | 'duplicate_slot'
  | 'unknown_slot'
  | 'missing_slot'
  | 'unused_slot'
  | 'malformed_slot'
  | 'flag_conflict'
  | 'label_mismatch'
  | 'unsupported_prose'
  | 'sentence_count';
export type NudgeValidation = { ok: true } | { ok: false; reason: ValidationReason };

const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();
const slotPattern = () => /\{\{([a-z][a-z_]*)\}\}/g;

/** The only free-prose clauses, each gated by the flags. The narration prompt lists exactly the allowed ones. */
function proseRules(flags: NarrationFlags): Map<string, boolean> {
  return new Map<string, boolean>([
    ['consider transit', true],
    ['compare your options', true],
    ['transit timing is unavailable', !flags.transitServiceKnown],
    ['transit is faster', flags.transitServiceKnown && flags.transitFaster],
    ['transit is cheaper', flags.transitCheaper],
    ['save with transit', flags.transitCheaper],
    ['check the next bus', flags.transitServiceKnown],
    ['an approved reward is available', flags.offerActive],
    ['an approved credit is available', flags.offerActive],
    ['traffic now', flags.trafficNow],
  ]);
}

export function allowedProse(flags: NarrationFlags): string[] {
  return [...proseRules(flags)].filter(([, allowed]) => allowed).map(([clause]) => clause);
}

function contradictsFlags(text: string, flags: NarrationFlags): boolean {
  return (
    (!flags.transitFaster && /\b(faster|fastest|quicker|quickest)\b/i.test(text))
    || (!flags.transitCheaper && /\b(cheap(?:er|est)?|sav(?:e[sd]?|ing[s]?)|less expensive)\b/i.test(text))
    || (!flags.transitServiceKnown && /\b(next (?:bus|departure)|(?:transit|bus) (?:time|duration|arriv(?:al|es)))\b/i.test(text))
    || (!flags.offerActive && /\b(rewards?|credits?|ecredits?|gift cards?|discounts?|offers?)\b/i.test(text))
    || (!flags.trafficNow && /\btraffic\b/i.test(text))
  );
}

/**
 * Facts and flags come from deterministic code, never from model output.
 * Grammar: standalone {{id}}, or the fact's exact label followed by ": {{id}}",
 * or a complete phrase in the flag-gated vocabulary below. Clauses may be
 * separated by semicolons within one or two sentences. Other prose fails closed.
 * Requiring the label to match binds entity, unit and period without guessing
 * natural-language semantics. See the root claim-validation vectors for examples.
 */
export function validateNudge(
  nudge: string,
  slots: readonly string[],
  facts: readonly NarrationFact[],
  flags: NarrationFlags,
): NudgeValidation {
  const reject = (reason: ValidationReason): NudgeValidation => ({ ok: false, reason });
  const parsed = inputSchema.safeParse({ nudge, slots, facts, flags });
  if (!parsed.success) return reject('invalid_input');
  if (!nudge.trim()) return reject('empty_nudge');
  // Unicode numeric characters are rejected too, not just ASCII digits.
  if (/\p{N}/u.test(nudge)) return reject('digit_in_nudge');

  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  if (byId.size !== facts.length || new Set(facts.map((fact) => normalize(fact.label))).size !== facts.length) {
    return reject('duplicate_fact');
  }
  if (new Set(slots).size !== slots.length) return reject('duplicate_slot');
  if (slots.some((id) => !byId.has(id))) return reject('unknown_slot');
  const referenced = [...nudge.matchAll(slotPattern())].map((match) => match[1]);
  if (/[{}]/.test(nudge.replace(slotPattern(), ''))) return reject('malformed_slot');
  if (referenced.some((id) => !byId.has(id))) return reject('unknown_slot');
  if (referenced.some((id) => !slots.includes(id))) return reject('missing_slot');
  if (slots.some((id) => !referenced.includes(id))) return reject('unused_slot');
  if (contradictsFlags(nudge.replace(slotPattern(), ''), flags)) return reject('flag_conflict');
  for (const id of referenced) {
    const fact = byId.get(id);
    if (!fact) return reject('unknown_slot');
    if (contradictsFlags(`${fact.label} ${fact.phrase}`, flags)) return reject('flag_conflict');
  }

  const sentences = nudge.trim().split(/[.!?]/);
  if (sentences.at(-1) === '') sentences.pop();
  if (sentences.length < 1 || sentences.length > 2) return reject('sentence_count');
  const prose = proseRules(flags);
  for (const clause of sentences.flatMap((sentence) => sentence.split(';'))) {
    const text = clause.trim();
    const factClause = text.match(/^(?:([A-Za-z][A-Za-z '-]*):\s*)?\{\{([a-z][a-z_]*)\}\}$/);
    if (factClause) {
      const fact = byId.get(factClause[2]);
      if (!fact) return reject('unknown_slot');
      if (factClause[1] && normalize(factClause[1]) !== normalize(fact.label)) return reject('label_mismatch');
    } else {
      const allowed = prose.get(normalize(text));
      if (allowed === undefined) return reject('unsupported_prose');
      if (!allowed) return reject('flag_conflict');
    }
  }
  return { ok: true };
}

/** Revalidate the exact inputs so a failed check or a changed fact cannot reach substitution. */
export function substituteNudge(
  nudge: string,
  slots: readonly string[],
  facts: readonly NarrationFact[],
  flags: NarrationFlags,
): string {
  const validation = validateNudge(nudge, slots, facts, flags);
  if (!validation.ok) throw new Error(`Nudge rejected: ${validation.reason}`);
  const byId = new Map(facts.map((fact) => [fact.id, fact.phrase]));
  return nudge.replace(slotPattern(), (_match, id: string) => {
    const phrase = byId.get(id);
    if (phrase === undefined) throw new Error('Nudge rejected: unknown_slot');
    return phrase;
  });
}
