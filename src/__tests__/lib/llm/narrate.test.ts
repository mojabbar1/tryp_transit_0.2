/**
 * Narration by reference and the deterministic template (P1c T5).
 */

import vectors from '../../../../contracts/claim-validation.vectors.json';
import type { LlmProvider } from '@/lib/llm/provider';
import { buildNarrationPrompt, narrate } from '@/lib/llm/narrate';
import { LlmError } from '@/lib/llm/shared';
import { renderTemplate } from '@/lib/llm/template';
import type { NarrationFact, NarrationFlags } from '@/lib/llm/validate-claims';

const facts: NarrationFact[] = [
  { id: 'drive_minutes', label: 'Drive time', phrase: 'about 21 min by car' },
  { id: 'bus_fare', label: 'Bus fare', phrase: 'a $2.00 base fare' },
];
const flags: NarrationFlags = { transitServiceKnown: false, transitFaster: false, transitCheaper: false, offerActive: false, trafficNow: true };
const TEMPLATE = 'Traffic now is heavy, and driving takes about 21 min by car.';

const fakeProvider = (reply: () => Promise<unknown>): LlmProvider => ({
  name: 'gemini',
  model: 'gemini-3.8-flash',
  generateJson: <T,>() => reply() as Promise<T>,
});
const run = (provider: LlmProvider | null, f = facts, fl = flags) =>
  narrate({ provider, facts: f, flags: fl, timeoutMs: 1000, template: TEMPLATE });

describe('narrate', () => {
  it('uses the template when no provider is configured', async () => {
    expect(await run(null)).toEqual({ nudge: TEMPLATE, narration: { source: 'template', provider: 'template', validated: false } });
  });

  it('substitutes fact phrases into a validated nudge', async () => {
    const outcome = await run(fakeProvider(async () => ({ nudge: 'Traffic now; Drive time: {{drive_minutes}}. Consider transit.', slots: ['drive_minutes'] })));
    expect(outcome).toEqual({
      nudge: 'Traffic now; Drive time: about 21 min by car. Consider transit.',
      narration: { source: 'llm', provider: 'gemini', model: 'gemini-3.8-flash', validated: true },
    });
  });

  it.each([
    ['a digit (numbers by reference)', { nudge: 'Leave by 8 to beat the traffic.', slots: [] }, 'nudge_digit_in_nudge'],
    ['an unknown slot', { nudge: '{{parking_cost}}.', slots: ['parking_cost'] }, 'nudge_unknown_slot'],
    ['a claim the flags contradict', { nudge: 'Transit is cheaper.', slots: [] }, 'nudge_flag_conflict'],
    ['free prose', { nudge: 'Skip the stress and ride the bus.', slots: [] }, 'nudge_unsupported_prose'],
    ['an over-long nudge', { nudge: `Consider transit${'; compare your options'.repeat(30)}.`, slots: [] }, 'nudge_too_long'],
  ])('falls back to the template on %s', async (_label, reply, reasonCode) => {
    const outcome = await run(fakeProvider(async () => reply));
    expect(outcome).toEqual({
      nudge: TEMPLATE,
      narration: { source: 'template', provider: 'gemini', model: 'gemini-3.8-flash', validated: false },
      fallbackReason: reasonCode,
    });
  });

  it('rejects the shared swap counterexample and falls back', async () => {
    const swap = vectors.cases.find((entry) => entry.id === 'swap');
    if (!swap) throw new Error('swap vector missing');
    const outcome = await run(fakeProvider(async () => ({ nudge: swap.nudge, slots: swap.slots })), swap.facts, swap.flags);
    expect(outcome.narration).toMatchObject({ source: 'template', validated: false });
    expect(outcome.fallbackReason).toBe(`nudge_${(swap.expected as { reason: string }).reason}`);
  });

  it.each(['llm_timeout', 'llm_invalid_json', 'llm_schema_mismatch'] as const)('falls back on provider failure %s', async (code) => {
    const outcome = await run(fakeProvider(async () => { throw new LlmError(code); }));
    expect(outcome.fallbackReason).toBe(code);
    expect(outcome.nudge).toBe(TEMPLATE);
  });

  it('reduces an unexpected provider error to a code without its message', async () => {
    const outcome = await run(fakeProvider(async () => { throw new Error('boom key=abc'); }));
    expect(outcome.fallbackReason).toBe('llm_request_failed');
  });
});

describe('buildNarrationPrompt', () => {
  it('lists facts by id, label and phrase, and only the phrases the flags allow', () => {
    const { system, user } = buildNarrationPrompt(facts, flags);
    expect(JSON.parse(user)).toEqual({ facts, flags });
    expect(system).toContain('Traffic now');
    expect(system).toContain('Transit timing is unavailable');
    expect(system).not.toContain('Transit is cheaper');
    expect(system).not.toContain('An approved reward is available');
  });
});

describe('renderTemplate', () => {
  it('renders traffic, a signed cost and the unavailable timing note in two sentences', () => {
    const text = renderTemplate({
      density: 'Heavy',
      drivePhrase: 'about 21 min by car',
      cost: { differenceCents: -51, phrase: 'about $0.51 more than driving' },
      basis: 'unavailable',
    });
    expect(text).toBe(
      "Traffic now is heavy, and driving takes about 21 min by car. The bus base fare is about $0.51 more than driving per trip; bus timing isn't available yet, so check CARTA's schedule.",
    );
    expect(text.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(2);
  });

  it('says so when live traffic, routing and cost are unavailable, and handles an equal cost', () => {
    expect(renderTemplate({ density: null, basis: 'unavailable' })).toBe(
      "Live traffic is unavailable. Bus timing isn't available yet, so check CARTA's schedule.",
    );
    expect(renderTemplate({ density: 'Light', drivePhrase: 'about 9 min by car', cost: { differenceCents: 0, phrase: 'x' }, basis: 'unavailable' }))
      .toContain('The bus base fare costs about the same as driving per trip');
  });
});
