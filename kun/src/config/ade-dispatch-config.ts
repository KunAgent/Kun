import { z } from 'zod'

/**
 * Dispatch cards waiting on the user start on their own after `autoStartSeconds`
 * without a response (0 = always wait). Ask-for-approval cards join the window
 * only when `autoStartWhenConfirmationRequired` is set; their workers still ask
 * before each action.
 */
export const AdeDispatchConfigSchema = z
  .object({
    autoStartSeconds: z.number().int().min(0).max(3_600).default(60),
    autoStartWhenConfirmationRequired: z.boolean().default(true)
  })
  .strict()
  .default({ autoStartSeconds: 60, autoStartWhenConfirmationRequired: true })
export type AdeDispatchConfig = z.infer<typeof AdeDispatchConfigSchema>
