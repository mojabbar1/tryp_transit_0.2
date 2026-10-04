import 'server-only';
import { getStats } from '@/lib/api/data-agent';
import type { ServerEnv } from '@/lib/env';
import { citationFromAgent } from '@/lib/facts/approved';
import type { StatsResponse, StatView } from './types';

/**
 * Headline stats from approved facts only (`/v1/stats`, shared for an hour). A stat without a value or a citation
 * is dropped, never shown uncited. With the agent off or down nothing is shown: there is no local fallback for
 * stats, so the page says the data is unavailable.
 */
export async function loadStats(env: Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>): Promise<StatsResponse> {
  const result = await getStats(env);
  if (!result.ok) return { available: false, items: [], degraded: ['data_agent_unavailable'] };
  const items: StatView[] = [];
  for (const stat of result.data.items) {
    if (stat.value_num === null && !stat.value_text) continue;
    const citations = stat.citations.map((citation) => citationFromAgent(citation, citation.fact_key ?? stat.id));
    if (citations.length === 0) continue;
    items.push({ id: stat.id, label: stat.label, valueNum: stat.value_num, valueText: stat.value_text, unit: stat.unit, period: stat.period, citations });
  }
  return { available: items.length > 0, items, degraded: items.length > 0 ? [] : ['stats_unavailable'] };
}
