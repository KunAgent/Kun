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

/**
 * Suggestion cards (`suggest_tasks`): `autoStartSeconds` 0 keeps every card
 * waiting for the user; `worktree` and `inheritContext` are the per-task
 * defaults a new card starts with.
 */
export const AdeTasksConfigSchema = z
  .object({
    autoStartSeconds: z.number().int().min(0).max(3_600).default(0),
    worktree: z.boolean().default(true),
    inheritContext: z.boolean().default(false)
  })
  .strict()
  .default({ autoStartSeconds: 0, worktree: true, inheritContext: false })
export type AdeTasksConfig = z.infer<typeof AdeTasksConfigSchema>
