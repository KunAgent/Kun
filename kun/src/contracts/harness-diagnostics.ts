import { z } from 'zod'

/**
 * One row of an Agent's readiness diagnostics: what Kun found and whether it
 * blocks use. Values are technical, bounded and never carry secrets; clients
 * localize the label from `id`.
 */
export const HarnessDiagnosticRowSchema = z.object({
  id: z.enum(['configuration', 'command', 'version', 'network', 'credentials', 'protocol', 'models']),
  status: z.enum(['ok', 'warn', 'error', 'info']),
  value: z.string().max(512)
}).strict()
export type HarnessDiagnosticRow = z.infer<typeof HarnessDiagnosticRowSchema>
