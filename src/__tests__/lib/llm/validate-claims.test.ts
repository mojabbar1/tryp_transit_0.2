import vectors from '../../../../contracts/claim-validation.vectors.json';
import {
  substituteNudge, validateNudge,
  type NarrationFact, type NarrationFlags,
} from '@/lib/llm/validate-claims';

const flags: NarrationFlags = {
  transitServiceKnown: false, transitFaster: false, transitCheaper: false, offerActive: false, trafficNow: false,
};
const facts: NarrationFact[] = [{ id: 'drive_minutes', label: 'Drive time', phrase: 'about 25 minutes by car' }];

describe('shared claim validation vectors', () => {
  it('includes the required semantic counterexamples and at least twelve cases', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(vectors.cases.map(({ id }) => id)).size).toBe(vectors.cases.length);
    for (const id of ['swap', 'period', 'negation', 'unit']) {
      const vector = vectors.cases.find((entry) => entry.id === id);
      expect(vector?.expected.ok).toBe(false);
      expect(vector?.nudge).not.toMatch(/\d/);
      expect(vectors.rules).toHaveProperty(id);
    }
  });

  it.each(vectors.cases)('$id', (vector) => {
    const { nudge, slots, facts: suppliedFacts, flags: suppliedFlags, expected } = vector;
    expect(validateNudge(nudge, slots, suppliedFacts, suppliedFlags)).toEqual(expected);
    if (expected.ok) {
      expect(substituteNudge(nudge, slots, suppliedFacts, suppliedFlags)).toBe(vector.substituted);
    } else {
      expect(() => substituteNudge(nudge, slots, suppliedFacts, suppliedFlags)).toThrow(`Nudge rejected: ${expected.reason}`);
    }
  });
});

describe('fail-closed validation and substitution', () => {
  it.each([
    ['{{drive_minutes}', 'malformed_slot'],
    ['{{{drive_minutes}}}', 'malformed_slot'],
    ['{{ drive_minutes }}', 'malformed_slot'],
    ['{{drive_minutes}} {{unknown}}', 'unknown_slot'],
    ['{{drive_minutes}} is not drive time', 'unsupported_prose'],
    ['{{drive_minutes}} miles', 'unsupported_prose'],
  ])('rejects malformed or reinterpreted slots: %s', (nudge, reason) => {
    expect(validateNudge(nudge, ['drive_minutes'], facts, flags)).toEqual({ ok: false, reason });
  });

  it('rejects duplicate declarations, unused slots, and ambiguous fact identities', () => {
    expect(validateNudge('{{drive_minutes}}', ['drive_minutes', 'drive_minutes'], facts, flags))
      .toEqual({ ok: false, reason: 'duplicate_slot' });
    expect(validateNudge('Consider transit', ['drive_minutes'], facts, flags))
      .toEqual({ ok: false, reason: 'unused_slot' });
    expect(validateNudge('{{drive_minutes}}', ['drive_minutes'], [...facts, ...facts], flags))
      .toEqual({ ok: false, reason: 'duplicate_fact' });
    expect(validateNudge('{{drive_minutes}}', ['drive_minutes'], [...facts, { ...facts[0], id: 'other' }], flags))
      .toEqual({ ok: false, reason: 'duplicate_fact' });
  });

  it('rejects malformed runtime input rather than trusting TypeScript annotations', () => {
    // @ts-expect-error Simulate an unparsed provider response.
    expect(validateNudge(null, [], facts, flags)).toEqual({ ok: false, reason: 'invalid_input' });
    // @ts-expect-error Simulate a provider returning the wrong slots type.
    expect(validateNudge('Consider transit', null, facts, flags)).toEqual({ ok: false, reason: 'invalid_input' });
    // @ts-expect-error Simulate an incomplete flag object.
    expect(validateNudge('Consider transit', [], facts, {})).toEqual({ ok: false, reason: 'invalid_input' });
    expect(validateNudge('{{drive_minutes}}', ['drive_minutes'], [{ ...facts[0], phrase: '' }], flags))
      .toEqual({ ok: false, reason: 'invalid_input' });
  });

  it.each(['Transit is not faster', 'Transit is never faster', 'Transit is not slower', 'Transit is not cheaper'])(
    'does not ignore negation even when positive flags are true: %s', (nudge) => {
      expect(validateNudge(nudge, [], [], { ...flags, transitServiceKnown: true, transitFaster: true, transitCheaper: true }))
        .toEqual({ ok: false, reason: 'unsupported_prose' });
    },
  );

  it('revalidates inputs changed after an earlier success', () => {
    const suppliedFacts = facts.map((fact) => ({ ...fact }));
    expect(validateNudge('Drive time: {{drive_minutes}}', ['drive_minutes'], suppliedFacts, flags)).toEqual({ ok: true });
    suppliedFacts[0].label = 'Transit time';
    expect(() => substituteNudge('Drive time: {{drive_minutes}}', ['drive_minutes'], suppliedFacts, flags)).toThrow();
  });

  it('preserves trusted phrase text literally, with no replacement-string interpolation', () => {
    const money = [{ id: 'fare', label: 'Fare', phrase: '$2.00 ($&)' }];
    expect(substituteNudge('{{fare}}; {{fare}}.', ['fare'], money, flags)).toBe('$2.00 ($&); $2.00 ($&).');
  });

  it('handles case and whitespace without changing a fact binding', () => {
    expect(substituteNudge('  DRIVE TIME: {{drive_minutes}}.  ', ['drive_minutes'], facts, flags))
      .toBe('  DRIVE TIME: about 25 minutes by car.  ');
  });

  it.each([
    ['Transit is faster', { transitServiceKnown: true, transitFaster: true }],
    ['Transit is cheaper', { transitCheaper: true }],
    ['Save with transit', { transitCheaper: true }],
    ['Check the next bus', { transitServiceKnown: true }],
    ['An approved reward is available', { offerActive: true }],
    ['An approved credit is available', { offerActive: true }],
    ['Traffic now', { trafficNow: true }],
  ])('accepts flag-backed prose: %s', (nudge, enabled) => {
    expect(validateNudge(nudge, [], [], { ...flags, ...enabled })).toEqual({ ok: true });
  });

  it('does not claim missing service when it is known or speed when service is unknown', () => {
    expect(validateNudge('Transit timing is unavailable', [], [], { ...flags, transitServiceKnown: true }))
      .toEqual({ ok: false, reason: 'flag_conflict' });
    expect(validateNudge('Transit is faster', [], [], { ...flags, transitFaster: true }))
      .toEqual({ ok: false, reason: 'flag_conflict' });
  });

  it.each(['Consider transit. Compare your options. Consider transit.', 'Consider transit..', '.', ';'])(
    'rejects excessive sentences or empty clauses: %s', (nudge) => {
      expect(validateNudge(nudge, [], [], flags).ok).toBe(false);
    },
  );
});
