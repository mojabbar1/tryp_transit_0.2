/**
 * Regression (#14 review): the actual routes page, server-rendered with a mocked travel context and router.
 */

import { renderToString } from 'react-dom/server';

const mockPush = jest.fn();
let mockTrip: Record<string, unknown>;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/contexts/travel-context', () => ({ useTravelContext: () => mockTrip }));

import RoutesPage from '@/app/routes/page';
import { shouldLeaveRoutesPage, visibleIncentive } from '@/lib/trip-view';

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
    expect(text).toContain('Travel Time Unavailable');
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
});
