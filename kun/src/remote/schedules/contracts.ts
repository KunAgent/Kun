import { z } from 'zod'
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
export const ScheduleListParams = z.object(Page).strict()
export const ScheduleRunsParams = z.object({ ...Page, scheduleId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict()
export const ScheduleParamSchemas = { 'schedule.list': ScheduleListParams, 'schedule.runs.list': ScheduleRunsParams } as const
