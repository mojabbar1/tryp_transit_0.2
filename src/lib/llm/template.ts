import 'server-only';
import type { TrafficDensity, TransitBasis } from '@/lib/contracts/transit-insights';

export interface TemplateInput {
  density: TrafficDensity | null;
  /** Rendered drive-time phrase, e.g. "about 21 min by car"; absent when routing failed. */
  drivePhrase?: string;
  /** Signed drive − transit cost in cents and its rendered phrase; absent when cost is unknown. */
  cost?: { differenceCents: number; phrase: string };
  basis: TransitBasis;
  /** Rendered scheduled-bus phrase, e.g. "about 18 min by bus on route 10" (P4b). */
  busPhrase?: string;
  /** Rendered leave-by phrase, e.g. "leave by 8:02 AM" (P4b). */
  leaveByPhrase?: string;
  /** Why no scheduled trip was found, as plain text (P4b). */
  reasonText?: string;
}

/**
 * Deterministic nudge (the fallback whenever narration is unavailable or rejected). Two sentences at most,
 * numbers only from the rendered fact phrases, calm tone, and no claim the inputs don't support.
 */
export function renderTemplate({ density, drivePhrase, cost, basis, busPhrase, leaveByPhrase, reasonText }: TemplateInput): string {
  const traffic = density ? `Traffic now is ${density.toLowerCase()}` : 'Live traffic is unavailable';
  const first = drivePhrase ? `${traffic}, and driving takes ${drivePhrase}.` : `${traffic}.`;

  const clauses: string[] = [];
  if (cost) {
    clauses.push(
      cost.differenceCents === 0
        ? 'the bus base fare costs about the same as driving per trip'
        : `the bus base fare is ${cost.phrase} per trip`,
    );
  }
  if (basis !== 'unavailable' && busPhrase) {
    clauses.push(`the scheduled bus takes ${busPhrase}${leaveByPhrase ? `, so ${leaveByPhrase}` : ''}`);
  } else if (reasonText) {
    clauses.push(`${reasonText.replace(/[.]$/, '').replace(/^./, (c) => c.toLowerCase())}, so check CARTA's schedule`);
  } else if (basis === 'unavailable') {
    clauses.push("bus timing isn't available yet, so check CARTA's schedule");
  }
  if (clauses.length === 0) return first;
  const second = clauses.join('; ');
  return `${first} ${second.charAt(0).toUpperCase()}${second.slice(1)}.`;
}
