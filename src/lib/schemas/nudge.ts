import { z } from 'zod'

export const nudgeSchema = z.object({
	message: z.string().min(1),
	type: z.enum(['incentive', 'reminder', 'celebration']).optional(),
	actionable: z.boolean().optional(),
})

export type Nudge = z.infer<typeof nudgeSchema>



