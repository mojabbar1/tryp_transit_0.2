/**
 * P4b: the citations footnote, the honest stats pages (dashboard, emissions, safety/cost), and the reward gating.
 * Server components are rendered to HTML with the data agent mocked through `fetch`; all values are synthetic.
 */

let mockEnvSource: Record<string, string | undefined> = {};
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return { ...actual, getEnv: () => actual.parseEnv(mockEnvSource) };
});

import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import DashboardPage from '@/app/dashboard/page';
import EmissionsStatsPage from '@/app/emissions-stats/page';
import IncentivesPage from '@/app/incentives/page';
import SafetyCostComparisonPage from '@/app/safety-cost-comparison/page';
import { Citations } from '@/components/citations';
import { DemoBanner } from '@/components/demo-badge';
import { clearDataAgentCaches } from '@/lib/api/data-agent';
import { buildFootnotes } from '@/lib/citations';
import { costRows, emissionsRows } from '@/lib/facts/pages';
import { formatStatValue } from '@/lib/stats/format';

const visibleText = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const render = async (page: () => Promise<ReactElement> | ReactElement) => visibleText(renderToString(await page()));

const BASE = 'http://data-agent.test';
const fact = (id: number, key: string, valueNum: number | null, valueText: string | null = null) => ({
  id, key, version: 1, supersedes_id: null, value_num: valueNum, value_text: valueText, unit: 'unit', geography: null,
  period: { start: null, end: null }, method: null,
  sources: [{ source_id: `src-${id}`, attribution: `Synthetic source ${id}`, retrieved: '2026-10-01' }],
  derived_from: {}, evidence: {}, status: 'approved', confidence: null, valid_until: null,
});
let replies: Record<string, () => Response>;
const fetchMock = jest.fn(async (input: URL | string) => replies[new URL(String(input)).pathname]?.() ?? new Response('{}', { status: 404 }));
const savedDemo = process.env.NEXT_PUBLIC_DEMO_MODE;

beforeEach(() => {
  clearDataAgentCaches();
  mockEnvSource = {};
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  replies = {};
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = savedDemo;
});

describe('buildFootnotes / <Citations>', () => {
  it('names what each source backs, keeps attribution, dedupes, and lists uncovered keys', () => {
    const notes = buildFootnotes(
      [
        { ref: 'transit.base_fare_usd', sourceId: 's1', attribution: 'CARTA Fares', retrieved: '2026-09-25', url: 'https://ridecarta.com/fares-passes/' },
        { ref: 'transit.base_fare_usd', sourceId: 's1', attribution: 'CARTA Fares' },
        { ref: 'custom.key', attribution: 'Bidi\u202E text\u0007' },
      ],
      ['transit.base_fare_usd', 'drive.mpg'],
    );
    expect(notes).toEqual([
      { id: 'transit.base_fare_usd|s1|CARTA Fares', label: 'CARTA base fare', attribution: 'CARTA Fares', retrieved: '2026-09-25', url: 'https://ridecarta.com/fares-passes/' },
      { id: 'custom.key||Bidi text', label: 'custom.key', attribution: 'Bidi text', retrieved: null, url: null },
      { id: 'drive.mpg', label: 'Average fuel economy', attribution: null, retrieved: null, url: null },
    ]);
  });

  it('drops non-http links', () => {
    expect(buildFootnotes([{ ref: 'x', attribution: 'A', url: 'javascript:alert(1)' }])[0].url).toBeNull();
  });

  it('renders nothing without citations, and escaped text with safe links otherwise', () => {
    expect(renderToString(<Citations sources={[]} citations={[]} />)).toBe('');
    const html = renderToString(<Citations sources={[{ ref: 'gtfs.schedule', attribution: '<img src=x>', url: 'https://example.test' }]} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(visibleText(html)).toContain('Sources');
  });
});

describe('page rows: approved facts or computations from them, else unavailable', () => {
  const approved = (key: string, valueNum: number) => ({ key, valueNum, valueText: null, unit: null, origin: 'data_agent' as const, citations: [{ ref: key }] });

  it('emissions: derived rows come only from their approved inputs', () => {
    const rows = emissionsRows({
      'co2.car_g_per_mile': approved('co2.car_g_per_mile', 400),
      'co2.car_occupancy': approved('co2.car_occupancy', 1),
      'co2.bus_g_per_passenger_mile': approved('co2.bus_g_per_passenger_mile', 290),
    });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.value]))).toEqual({
      car_vehicle_mile: '400 g CO2', car_occupancy: '1 person', car_passenger_mile: '400 g CO2', bus_passenger_mile: '290 g CO2', difference_passenger_mile: '110 g CO2',
    });
    const missingBus = emissionsRows({ 'co2.car_g_per_mile': approved('co2.car_g_per_mile', 400), 'co2.car_occupancy': approved('co2.car_occupancy', 1) });
    expect(missingBus.find((row) => row.id === 'difference_passenger_mile')?.value).toBeNull();
    expect(emissionsRows({}).every((row) => row.value === null)).toBe(true);
  });

  it('cost: marginal per mile is gasoline ÷ mpg + maintenance; missing inputs give no number', () => {
    const rows = costRows({
      'drive.fuel_price_usd_per_gal': approved('drive.fuel_price_usd_per_gal', 4.163),
      'drive.mpg': approved('drive.mpg', 22.2),
      'drive.maintenance_usd_per_mile': approved('drive.maintenance_usd_per_mile', 0.1104),
    });
    expect(rows.find((row) => row.id === 'marginal_per_mile')?.value).toBe('$0.30');
    expect(rows.find((row) => row.id === 'fare')?.value).toBeNull();
    expect(costRows({}).every((row) => row.value === null)).toBe(true);
  });

  it('formats a stat from its own value and unit only', () => {
    expect(formatStatValue({ valueNum: 1234567, valueText: null, unit: 'unlinked passenger trips' })).toBe('1,234,567 unlinked passenger trips');
    expect(formatStatValue({ valueNum: -3.5, valueText: null, unit: 'percent change' })).toBe('-3.5%');
    expect(formatStatValue({ valueNum: null, valueText: '35.5% (City view)', unit: null })).toBe('35.5% (City view)');
    expect(formatStatValue({ valueNum: null, valueText: null, unit: null })).toBe('Unavailable');
  });
});

describe('/dashboard', () => {
  it('live, agent off: "Data unavailable" and none of the demo figures', async () => {
    const text = await render(DashboardPage);
    expect(text).toContain('Data unavailable');
    expect(text).not.toMatch(/2,847|\$79\.1B|89\.3%|ARR|Investor/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live, agent on: approved stats with their citations', async () => {
    mockEnvSource = { DATA_AGENT_ENABLED: 'true', DATA_AGENT_BASE_URL: BASE };
    replies['/v1/stats'] = () => new Response(JSON.stringify({
      items: [{
        id: 'ridership.bus.latest_month', label: 'SYN ridership, bus (latest month)', value_num: 1000, value_text: null, unit: 'trips',
        period: { start: '2026-08-01', end: '2026-08-31' }, citations: [{ source_id: 'syn-ntd', attribution: 'Synthetic NTD', fact_id: 3, fact_key: 'syn.k' }],
      }],
    }));
    const text = await render(DashboardPage);
    expect(text).toContain('SYN ridership, bus (latest month)');
    expect(text).toContain('1,000 trips');
    expect(text).toContain('Synthetic NTD');
    expect(text).not.toContain('Data unavailable');
  });

  it('demo mode: the illustrative dashboard, badged', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    const text = await render(DashboardPage);
    expect(text).toContain('Demo data');
    expect(text).toContain('not real metrics');
  });
});

describe('/emissions-stats', () => {
  it('agent off: the approved 05 §2 values, cited and flagged as the fallback; the old table is gone', async () => {
    const text = await render(EmissionsStatsPage);
    expect(text).toContain('400 g CO2');
    expect(text).toContain('290 g CO2');
    expect(text).toContain('110 g CO2');
    expect(text).toContain('EPA-420-F-23-014');
    expect(text).toContain('FTA 2010 EPA-webinar deck');
    expect(text).toContain('approved assumptions table');
    expect(text).not.toMatch(/2\.680|89\.33|269\.33|1,347|66\.82|250 days|20 miles/);
  });

  it('agent on: the store facts and their attribution, no fallback note', async () => {
    mockEnvSource = { DATA_AGENT_ENABLED: 'true', DATA_AGENT_BASE_URL: BASE };
    replies['/v1/assumptions'] = () => new Response(JSON.stringify({
      // Each assumption is served under its own fact key.
      items: [fact(21, 'co2.car_g_per_mile', 404), fact(22, 'co2.car_occupancy', 1), fact(23, 'co2.bus_g_per_passenger_mile', 300)]
        .map((served) => ({ key: served.key, fact: served })),
      missing: [],
    }));
    const text = await render(EmissionsStatsPage);
    expect(text).toContain('404 g CO2');
    expect(text).toContain('104 g CO2');
    expect(text).toContain('Synthetic source 23');
    expect(text).not.toContain('approved assumptions table');
  });
});

describe('/safety-cost-comparison', () => {
  it('safety is "Data unavailable" with no uncited percentages; cost rows are cited', async () => {
    const text = await render(SafetyCostComparisonPage);
    expect(text).toContain('Data unavailable');
    expect(text).not.toMatch(/90%|70-80%|100%|20% \(fare/);
    expect(text).toContain('$4.163');
    expect(text).toContain('$0.30');
    expect(text).toContain('$2.00');
    expect(text).toContain('CARTA Fares & Passes');
  });
});

describe('rewards (D-25) and the demo banner (D-17)', () => {
  it('live mode: no reward tiers, and no banner', () => {
    const text = visibleText(renderToString(<IncentivesPage />));
    expect(text).toContain('No rewards are offered right now');
    expect(text).not.toMatch(/\$1|\$2|\$4|gift card/);
    expect(renderToString(<DemoBanner />)).toBe('');
  });

  it('demo mode: example tiers, each badged, plus the app-wide banner', () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    const text = visibleText(renderToString(<IncentivesPage />));
    expect(text).toContain('Demo only');
    expect(text.match(/Demo data/g)?.length).toBeGreaterThanOrEqual(4);
    expect(visibleText(renderToString(<DemoBanner />))).toContain('Demo mode');
  });
});
