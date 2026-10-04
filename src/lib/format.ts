/** Signed drive − transit cost (USD) as UI copy: "save $x", "about the same", or "costs $x more"; null when unknown. */
export function formatCostDifference(difference: number | null | undefined): string | null {
  if (difference === null || difference === undefined || !Number.isFinite(difference)) return null;
  const cents = Math.round(difference * 100);
  if (cents === 0) return 'about the same';
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return cents > 0 ? `save ${amount}` : `costs ${amount} more`;
}

/** "08:05" → "8:05 AM", "23:30" → "11:30 PM"; anything that isn't HH:MM is returned unchanged. */
export function formatClock(hhmm: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

const TRANSIT_REASON_TEXT: Record<string, string> = {
  no_boardable_trip: 'No direct bus you can still catch arrives by that time.',
  transfer_required: 'No single bus serves both stops; this trip needs a transfer, which isn’t supported yet.',
  no_service: 'There’s no scheduled bus service on that day.',
  unknown_stop: 'That stop isn’t in the current CARTA schedule.',
};

/** Plain-language text for a schedule lookup's reason code; never a number. */
export function transitReasonText(reason: string | null | undefined): string | null {
  return reason ? TRANSIT_REASON_TEXT[reason] ?? null : null;
}
