import { z } from 'zod'

export const ToolExecutionNetworkPolicy = z.enum(['none', 'approved', 'full'])
export type ToolExecutionNetworkPolicy = z.infer<typeof ToolExecutionNetworkPolicy>

/** Shared resource budget for every managed tool process. */
export const ToolExecutionBudget = z.object({
  timeoutMs: z.number().int().min(1).max(3_600_000),
  maxOutputBytes: z.number().int().min(1).max(64 * 1024 * 1024),
  maxProcesses: z.number().int().min(1).max(256).optional(),
  maxMemoryBytes: z.number().int().min(1).max(8 * 1024 * 1024 * 1024).optional(),
  maxCpuTimeMs: z.number().int().min(1).max(3_600_000).optional(),
  networkPolicy: ToolExecutionNetworkPolicy.default('none')
}).strict()
export type ToolExecutionBudget = z.infer<typeof ToolExecutionBudget>
