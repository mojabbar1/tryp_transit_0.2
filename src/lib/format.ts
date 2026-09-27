/** Signed drive − transit cost (USD) as UI copy: "save $x", "about the same", or "costs $x more"; null when unknown. */
export function formatCostDifference(difference: number | null | undefined): string | null {
  if (difference === null || difference === undefined || !Number.isFinite(difference)) return null;
  const cents = Math.round(difference * 100);
  if (cents === 0) return 'about the same';
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return cents > 0 ? `save ${amount}` : `costs ${amount} more`;
}
