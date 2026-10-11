import { z } from 'zod';
import { CitationRefSchema } from '@/lib/contracts/transit-insights';

/** GET /api/stats contract (client-safe). */
export const StatViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  valueNum: z.number().finite().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  period: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
  citations: z.array(CitationRefSchema).min(1),
});

export const StatsResponseSchema = z.object({
  available: z.boolean(),
  items: z.array(StatViewSchema),
  degraded: z.array(z.string()),
});

export type StatView = z.infer<typeof StatViewSchema>;
export type StatsResponse = z.infer<typeof StatsResponseSchema>;
