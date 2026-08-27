import { z } from 'zod'
import {
  ContextCompactionConfigSchema,
  FastContextConfigSchema,
  GraphRuntimeConfigSchema,
  KunServeConfigSchema,
  LabConfigSchema,
  ModelConfigSchema,
  QualityConfigSchema,
  RolesConfigSchema,
  RuntimeTuningConfigSchema,
  TokenEconomyConfigSchema
} from '../config/kun-config.js'
import { KunCapabilitiesConfig } from './capabilities.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'

const RuntimeConfigApplyServeConfig = KunServeConfigSchema.omit({
  host: true,
  port: true,
  dataDir: true,
  runtimeToken: true,
  insecure: true,
  storage: true
}).extend({
  tokenEconomy: TokenEconomyConfigSchema.optional()
})

const BrowserUseHostBindingToken = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/)

export const BrowserUseHostBinding = z.object({
  bridgeUrl: z.string().superRefine((value, context) => {
    try {
      const url = new URL(value)
      if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) context.addIssue({ code: 'custom', message: 'Browser Use host binding must use an exact loopback HTTP origin' })
    } catch {
      context.addIssue({ code: 'custom', message: 'Browser Use host binding URL is invalid' })
    }
  }),
  bridgeToken: BrowserUseHostBindingToken,
  approvalSigningKey: BrowserUseHostBindingToken
}).strict()

export const RuntimeConfigModelSelection = z.object({
  providerId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(512)
}).strict()

export const RuntimeConfigApplyRequest = z
  .object({
    serve: RuntimeConfigApplyServeConfig.optional(),
    models: ModelConfigSchema.optional(),
    modelSelection: RuntimeConfigModelSelection.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    graph: GraphRuntimeConfigSchema.optional(),
    roles: RolesConfigSchema.optional(),
    fastContext: FastContextConfigSchema.optional(),
    capabilities: KunCapabilitiesConfig.optional(),
    hooks: HooksConfigSchema.optional(),
    quality: QualityConfigSchema.optional(),
    lab: LabConfigSchema.optional(),
    /** Ephemeral desktop authority. Never merged into or persisted with KunConfig. */
    browserUseHostBinding: BrowserUseHostBinding.nullable().optional(),
    /** Compare-and-revoke guard used when one desktop owner exits. */
    browserUseHostBindingRevoke: BrowserUseHostBinding.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.browserUseHostBindingRevoke && value.browserUseHostBinding !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['browserUseHostBindingRevoke'],
        message: 'Browser Use binding revoke requires an explicit null replacement'
      })
    }
  })

export const RuntimeConfigApplyResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(['restart_required', 'invalid_config']),
      message: z.string()
    })
    .strict()
])

export type RuntimeConfigApplyRequest = z.infer<typeof RuntimeConfigApplyRequest>
export type RuntimeConfigApplyResponse = z.infer<typeof RuntimeConfigApplyResponse>
export type BrowserUseHostBinding = z.infer<typeof BrowserUseHostBinding>
