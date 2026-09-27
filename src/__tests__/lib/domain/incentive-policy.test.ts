import { evaluateIncentivePolicy } from '@/lib/domain/incentive-policy';

describe('evaluateIncentivePolicy', () => {
  it('hides rewards without an approved offer inventory, even though bounds were approved', () => {
    expect(evaluateIncentivePolicy()).toEqual({ incentiveDetails: null, offerActive: false });
  });

  it('does not carry active state or incentive values across calls', () => {
    const result = evaluateIncentivePolicy();
    result.offerActive = true;
    result.incentiveDetails = { type: 'eCredit', value: '$2.00', description: 'Unapproved test offer' };
    expect(evaluateIncentivePolicy()).toEqual({ incentiveDetails: null, offerActive: false });
  });
});
