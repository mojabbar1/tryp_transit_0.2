import { z } from 'zod'

export const transitInsightsSchema = z.object({
	summary: z.string().min(1).optional(),
	estimatedDuration: z.string().min(1).optional(),
	congestionLevel: z.enum(['low', 'moderate', 'high']).optional(),
	alternativeRoutes: z.array(z.string()).optional(),
	tips: z.array(z.string()).optional(),
})

export type TransitInsights = z.infer<typeof transitInsightsSchema>



