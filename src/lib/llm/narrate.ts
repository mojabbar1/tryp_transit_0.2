import 'server-only';
import { z } from 'zod/v4';
import type { Narration } from '@/lib/contracts/transit-insights';
import { allowedProse, substituteNudge, validateNudge, type NarrationFact, type NarrationFlags } from './validate-claims';
import { LlmError, type LlmProvider, toJsonSchema } from './shared';

const NudgeOutputSchema = z.object({ nudge: z.string(), slots: z.array(z.string()) }).strict();
const NUDGE_JSON_SCHEMA = toJsonSchema(NudgeOutputSchema);
const MAX_NUDGE_CHARS = 400;

export interface NarrationOutcome {
  nudge: string;
  narration: Narration;
  /** Why an attempted LLM narration fell back to the template (a reason code, for the log). */
  fallbackReason?: string;
}

const capitalize = (clause: string) => clause.charAt(0).toUpperCase() + clause.slice(1);

/** Facts-only prompt: the model sees rendered phrases and ids, never raw numbers, and answers with slots. */
export function buildNarrationPrompt(facts: readonly NarrationFact[], flags: NarrationFlags): { system: string; user: string } {
  const phrases = allowedProse(flags).map((clause) => `  - ${capitalize(clause)}`).join('\n');
  const system = [
    'You write a short, calm nudge that helps a Charleston commuter compare driving with CARTA transit.',
    'Rules:',
    '- Write one or two sentences. Separate clauses inside a sentence with "; ".',
    '- Never write a digit or a number word. Refer to a fact only with its {{fact_id}} slot; code replaces the slot with the fact phrase.',
    '- Each clause must be exactly one of: "{{fact_id}}"; "<the fact label>: {{fact_id}}" (the label copied exactly); or one of these phrases:',
    phrases,
    '- List every fact id you use in "slots". Use only ids from the facts provided.',
    '- No urgency, fear, promises, or claims beyond the facts.',
    'Answer with JSON: {"nudge": string, "slots": string[]}.',
  ].join('\n');
  const user = JSON.stringify({ facts: facts.map(({ id, label, phrase }) => ({ id, label, phrase })), flags }, null, 2);
  return { system, user };
}

/**
 * Narrates when a provider exists; otherwise returns the template. Fails closed: on a provider error, timeout,
 * invalid JSON, schema mismatch, or validator rejection, it returns the deterministic template instead.
 */
export async function narrate(options: {
  provider: LlmProvider | null;
  facts: readonly NarrationFact[];
  flags: NarrationFlags;
  timeoutMs: number;
  template: string;
}): Promise<NarrationOutcome> {
  const { provider, facts, flags, timeoutMs, template } = options;
  if (!provider) {
    return { nudge: template, narration: { source: 'template', provider: 'template', validated: false } };
  }
  const fallback = (reason: string): NarrationOutcome => ({
    nudge: template,
    narration: { source: 'template', provider: provider.name, model: provider.model, validated: false },
    fallbackReason: reason,
  });

  let output: z.infer<typeof NudgeOutputSchema>;
  try {
    const { system, user } = buildNarrationPrompt(facts, flags);
    output = await provider.generateJson({ system, user, schema: NudgeOutputSchema, jsonSchema: NUDGE_JSON_SCHEMA, timeoutMs });
  } catch (error) {
    return fallback(error instanceof LlmError ? error.reason : 'llm_request_failed');
  }
  if (output.nudge.length > MAX_NUDGE_CHARS) return fallback('nudge_too_long');
  const validation = validateNudge(output.nudge, output.slots, facts, flags);
  if (!validation.ok) return fallback(`nudge_${validation.reason}`);
  return {
    nudge: substituteNudge(output.nudge, output.slots, facts, flags),
    narration: { source: 'llm', provider: provider.name, model: provider.model, validated: true },
  };
}
