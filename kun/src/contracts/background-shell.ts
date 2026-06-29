import { z } from 'zod'

export const BackgroundShellStatus = z.enum(['running', 'completed', 'stopped', 'failed'])
export type BackgroundShellStatus = z.infer<typeof BackgroundShellStatus>

export const BackgroundShellRecord = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  command: z.string(),
  cwd: z.string(),
  shell: z.string(),
  status: BackgroundShellStatus,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  outputTruncated: z.boolean().optional(),
  outputFilePath: z.string().optional(),
  error: z.string().optional(),
  detached: z.boolean()
}).strict()
export type BackgroundShellRecord = z.infer<typeof BackgroundShellRecord>

export const BackgroundShellListResponse = z.object({
  sessions: z.array(BackgroundShellRecord),
  running: z.number().int().nonnegative()
}).strict()
export type BackgroundShellListResponse = z.infer<typeof BackgroundShellListResponse>

export const BackgroundShellStopResponse = z.object({
  sessionId: z.string().min(1),
  stopped: z.boolean()
}).strict()
export type BackgroundShellStopResponse = z.infer<typeof BackgroundShellStopResponse>
