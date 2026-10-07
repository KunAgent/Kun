import { z } from 'zod'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  SandboxModeSchema
} from './policy.js'
import { RuntimeCapabilityManifest } from './capabilities.js'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'

export const RuntimeBuildIdSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const RuntimeInfoResponse = z
  .object({
    host: z.string(),
    port: z.number().int().min(0).max(65_535),
    dataDir: z.string().min(1),
    configPath: z.string().optional(),
    model: z.string().optional(),
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).optional(),
    approvalPolicy: ApprovalPolicySchema.optional(),
    sandboxMode: SandboxModeSchema.optional(),
    approvalReviewer: ApprovalReviewerSchema.optional(),
    tokenEconomyMode: z.boolean().optional(),
    insecure: z.boolean().optional(),
    instanceId: z.string().min(1),
    serviceVersion: z.string().min(1),
    buildId: RuntimeBuildIdSchema.optional(),
    launchMode: z.enum(['foreground', 'shared', 'gui']),
    startedAt: z.string(),
    pid: z.number().int().positive().optional(),
    memoryUsage: z.object({
      rssBytes: z.number().int().nonnegative(),
      peakRssBytes: z.number().int().nonnegative(),
      heapUsedBytes: z.number().int().nonnegative(),
      heapTotalBytes: z.number().int().nonnegative(),
      externalBytes: z.number().int().nonnegative()
    }).strict().optional(),
    extensions: z.object({
      enabled: z.boolean(),
      apiVersions: z.array(z.string()),
      manifestVersions: z.array(z.number().int().positive()),
      packageRoot: z.string().min(1),
      dataRoot: z.string().min(1)
    }).strict().optional(),
    capabilities: RuntimeCapabilityManifest
  })
  .strict()
export type RuntimeInfoResponse = z.infer<typeof RuntimeInfoResponse>
