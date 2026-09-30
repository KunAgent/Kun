import { z } from 'zod'
import type { HarnessStatus } from './harness.js'

export const HarnessInstallRequestSchema = z.object({
  action: z.enum(['install', 'adapter']).default('install')
}).strict()
export const HarnessInstallCancelSchema = z.object({ jobId: z.string().uuid() }).strict()
export type HarnessInstallAction = z.infer<typeof HarnessInstallRequestSchema>['action']
export type HarnessInstallPlan = {
  action: HarnessInstallAction
  command: string
  platform: string
  available: boolean
  missingCommand?: string
}
export type HarnessInstallJob = {
  id: string
  harnessId: string
  command: string
  status: 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  output: string
  error?: string
  detected?: HarnessStatus
}
export type HarnessInstallState = { plan: HarnessInstallPlan | null; job?: HarnessInstallJob }
