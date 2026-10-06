import { HarnessGatewayBindingSchema } from '../contracts/harness-gateway-binding.js'
import { z } from 'zod'

/** `worker_create` tool input (09 §4.2). */
export const WorkerCreateInputSchema = z
  .object({
    label: z.string().min(1).max(64),
    role: z.string().max(64).optional(),
    task: z.string().min(1).max(32_000),
    context: z
      .object({
        files: z.array(z.string().min(1)).max(64).optional(),
        links: z.array(z.string().min(1)).max(32).optional(),
        constraints: z.array(z.string().min(1)).max(32).optional()
      })
      .strict()
      .optional(),
    agent: z
      .object({
        harnessId: z.string().min(1).max(64).optional(),
        model: z.string().min(1).max(512).optional(),
        providerId: z.string().min(1).max(128).optional(),
        credentialMode: z.string().min(1).max(64).optional(),
        gatewayBinding: HarnessGatewayBindingSchema.optional()
      })
      .strict()
      .optional(),
    workspace: z
      .object({
        isolation: z.enum(['worktree', 'local']).optional(),
        /** Reuse a live task workspace instead of creating one (11 §4.4). */
        reuseTaskWorkspaceId: z.string().min(1).max(256).optional(),
        startFrom: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('default-branch') }).strict(),
            z.object({ kind: z.literal('current-head') }).strict(),
            z.object({ kind: z.literal('branch'), name: z.string().min(1).max(256) }).strict(),
            // Pre-resolved pin — races fork every contender from the same sha (10 §6).
            z.object({ kind: z.literal('commit'), sha: z.string().regex(/^[a-f0-9]{7,64}$/) }).strict()
          ])
          .optional()
      })
      .strict()
      .optional(),
    permissionMode: z.string().min(1).max(64).optional(),
    lifecycle: z.enum(['persistent', 'ephemeral']).optional(),
    mode: z.enum(['queue', 'interrupt']).optional()
  })
  .strict()
export type WorkerCreateInput = z.infer<typeof WorkerCreateInputSchema>

export const WorkerCreateBatchInputSchema = z
  .object({ items: z.array(WorkerCreateInputSchema).min(1).max(16) })
  .strict()
export type WorkerCreateBatchInput = z.infer<typeof WorkerCreateBatchInputSchema>

export const WorkerStatusInputSchema = z
  .object({ workerId: z.string().min(1).max(256).optional() })
  .strict()

export const WorkerReadInputSchema = z
  .object({
    workerId: z.string().min(1).max(256),
    limit: z.number().int().min(1).max(50).optional()
  })
  .strict()
