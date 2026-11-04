import { z } from 'zod'
import type { ScheduledTaskV1 } from './app-settings'

export const scheduleTasksBulkInputSchema = z.object({
  taskIds: z.array(z.string().trim().min(1).max(256)).min(1).max(512),
  action: z.enum(['enable', 'disable', 'delete'])
}).strict()

export type ScheduleTasksBulkInput = z.infer<typeof scheduleTasksBulkInputSchema>
export type ScheduleTasksBulkAction = ScheduleTasksBulkInput['action']
export type ScheduleTasksBulkResult =
  | { ok: true; tasks: ScheduledTaskV1[] }
  | { ok: false; message: string }
