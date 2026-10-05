/**
 * Regression (#14 review): the actual routes page, server-rendered with a mocked travel context and router.
 */

import { renderToString } from 'react-dom/server';

const mockPush = jest.fn();
let mockTrip: Record<string, unknown>;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/contexts/travel-context', () => ({ useTravelContext: () => mockTrip }));

import RoutesPage from '@/app/routes/page';
import { type TransitInsightResponse, TransitInsightResponseSchema } from '@/lib/contracts/transit-insights';
import { shouldLeaveRoutesPage, tripSummaryFrom, visibleIncentive } from '@/lib/trip-view';

const allUnavailable = {
  hasTrip: true,
  travelTime: null,
  trafficDensity: null,
  costSavings: null,
  additionalRides: [],
  incentiveDetails: null,
  offerActive: false,
  isDemo: false,
  setTravelData: () => undefined,
};
const reward = { type: 'eCredit' as const, description: 'Earn $2.00 transit credit', value: '$2.00' };
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const savedDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
afterEach(() => {
  if (savedDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = savedDemo;
});

describe('routes page', () => {
  it('renders a successful trip whose measurements are all unavailable, and does not leave', () => {
    mockTrip = allUnavailable;
    const text = visibleText(renderToString(<RoutesPage />));
    expect(text).toContain("Bus timing isn't available yet");
    expect(text).toContain('Traffic now Unavailable');
    expect(text).toContain('Bus time Unavailable');
    expect(text).not.toContain('Incentive');
    expect(text).not.toContain('DID YOU KNOW');
    expect(shouldLeaveRoutesPage(allUnavailable)).toBe(false);
  });

  it('leaves only when no trip was loaded', () => {
    expect(shouldLeaveRoutesPage({ hasTrip: false })).toBe(true);
  });

  it('shows no reward for a live trip with no active offer, even in a demo-mode build', () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    mockTrip = { ...allUnavailable, trafficDensity: 'Medium', costSavings: -0.51 };
    const text = visibleText(renderToString(<RoutesPage />));
    expect(text).not.toMatch(/Incentive|e-card/);
    expect(text).toContain('costs $0.51 more');
  });

  it('shows the response reward only while its offer is active, badged when it is demo data', () => {
    mockTrip = { ...allUnavailable, incentiveDetails: reward, offerActive: true, isDemo: true };
    const text = visibleText(renderToString(<RoutesPage />));
    expect(text).toContain('Incentive Demo');
    expect(text).toContain('$2.00');
    expect(visibleIncentive({ incentiveDetails: reward, offerActive: false })).toBeNull();
  });

  it('a scheduled trip shows the leave-by time and route, its alerts as text, and its sources (P4b)', () => {
    mockTrip = {
      ...allUnavailable,
      travelTime: 18,
      transitBasis: 'scheduled',
      leaveBy: '08:05',
      routeShortName: '10',
      alerts: [{ header: 'Detour on <b>Meeting</b> St', url: 'https://example.test/a' }],
      sources: [{ ref: 'gtfs.schedule', sourceId: 'synthetic-gtfs', attribution: 'Synthetic test feed' }],
      citations: ['transit.base_fare_usd'],
    };
    const html = renderToString(<RoutesPage />);
    const text = visibleText(html);
    expect(text).toContain('Leave for the stop by 8:05 AM to catch route 10 (scheduled)');
    expect(text).toContain('Bus time (scheduled) 18 minutes');
    expect(text).toContain('CARTA service alerts');
    // Alert text is escaped, never rendered as markup.
    expect(html).not.toContain('<b>Meeting</b>');
    expect(text).toContain('Sources');
    expect(text).toContain('Bus schedule : Synthetic test feed');
    expect(text).toContain('CARTA base fare');
  });

  it('no direct trip: the reason is text and no bus number is shown (P4b)', () => {
    mockTrip = { ...allUnavailable, transitBasis: 'unavailable', transitReason: 'transfer_required' };
    const text = visibleText(renderToString(<RoutesPage />));
    expect(text).toContain('this trip needs a transfer');
    expect(text).toContain('Bus time Unavailable');
    expect(text).not.toMatch(/Leave for the stop/);
  });

  describe('the retained summary keeps the trip’s day (review F3)', () => {
    // What /find-rides keeps from an answer made at 16:00 in New York on Oct 5 for an 08:30 arrival (Oct 6).
    const nextDayResponse: TransitInsightResponse = {
      travelTime: 18,
      trafficDensity: null,
      costSavingsPerTrip: null,
      nudgeMessage: null,
      incentiveDetails: null,
      additionalRides: [],
      comparison: {
        drive: null,
        transit: {
          basis: 'scheduled', minutes: 18, nextDepartures: ['08:10'], source: { name: 'Synthetic test feed GTFS schedule' },
          routing: 'direct_only', leaveBy: '08:05', routeShortName: '10',
          leaveByAt: '2026-10-06T08:05:00-04:00', departureAt: '2026-10-06T08:10:00-04:00', arrivalAt: '2026-10-06T08:28:00-04:00',
          serviceDate: '2026-10-06', targetAt: '2026-10-06T08:30:00-04:00',
        },
      },
      meta: {
        generatedAt: '2026-10-05T20:00:00.000Z', region: 'charleston-sc', timezone: 'America/New_York', demo: false, offerActive: false,
        narration: { source: 'template', provider: 'template', validated: false }, degraded: [], citations: [],
      },
    };
    const summaryOf = (response: TransitInsightResponse) => ({ ...tripSummaryFrom(response), hasTrip: true, setTravelData: () => undefined });

    it('a next-day trip says "tomorrow" on /routes', () => {
      expect(TransitInsightResponseSchema.safeParse(nextDayResponse).success).toBe(true);
      mockTrip = summaryOf(nextDayResponse);
      const text = visibleText(renderToString(<RoutesPage />));
      expect(text).toContain('Leave for the stop by 8:05 AM tomorrow to catch route 10 (scheduled)');
    });

    it('a later day shows its date, and the day is read in the region zone', () => {
      const transit = { ...nextDayResponse.comparison!.transit, leaveByAt: '2026-10-08T08:05:00-04:00' };
      mockTrip = summaryOf({ ...nextDayResponse, comparison: { ...nextDayResponse.comparison!, transit } });
      expect(visibleText(renderToString(<RoutesPage />))).toContain('Leave for the stop by 8:05 AM on Thu, Oct 8 to catch route 10');
      // 21:00 in New York is already the next day in UTC; for the rider it is still this evening.
      const evening = { ...nextDayResponse.comparison!.transit, leaveBy: '21:00', leaveByAt: '2026-10-05T21:00:00-04:00' };
      mockTrip = summaryOf({ ...nextDayResponse, comparison: { ...nextDayResponse.comparison!, transit: evening } });
      expect(visibleText(renderToString(<RoutesPage />))).toContain('Leave for the stop by 9:00 PM to catch route 10');
    });

    it('an older summary without the full time keeps the clock-only line', () => {
      mockTrip = { ...allUnavailable, travelTime: 18, transitBasis: 'scheduled', leaveBy: '08:05', routeShortName: '10' };
      expect(visibleText(renderToString(<RoutesPage />))).toContain('Leave for the stop by 8:05 AM to catch route 10 (scheduled)');
    });
  });
});
