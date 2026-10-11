import { z } from 'zod'
import { HarnessIdSchema } from './harness.js'

export const HarnessIntegrationOpenRequest = z.object({
  harnessId: HarnessIdSchema,
  action: z.enum(['application', 'configuration']),
  index: z.number().int().min(0).max(15).optional()
}).strict()
export type HarnessIntegrationOpenRequest = z.infer<typeof HarnessIntegrationOpenRequest>
export type HarnessIntegrationTarget = {
  path: string
  exists: boolean
  kind: 'application' | 'file' | 'directory'
}
export type HarnessIntegrationInfo = {
  harnessId: string
  kind: 'chat' | 'terminal' | 'application'
  application?: HarnessIntegrationTarget
  configurations: HarnessIntegrationTarget[]
  docsUrl?: string
}
export type HarnessIntegrationOpenResult = { ok: true } | { ok: false; message: string }
