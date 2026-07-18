import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  ContextCompactionConfigSchema,
  DEFAULT_KUN_MODEL,
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG,
  ModelRequestRetryConfigSchema,
  ModelConfigSchema,
  ObservabilityConfigSchema,
  QualityConfigSchema,
  RolesConfigSchema,
  RuntimeTuningConfigSchema,
  ServeProviderConfigSchema,
  StorageConfigSchema,
  TokenEconomyConfigSchema,
  ToolOutputLimitsConfigSchema
} from '../config/kun-config.js'
import {
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  KunCapabilitiesConfig
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'
import { isLoopbackHost } from '../server/loopback-host.js'

export const DEFAULT_SERVE_PORT = 18899
export const DEFAULT_SERVE_MODEL = DEFAULT_KUN_MODEL

/**
 * Validated CLI options for `kun serve`.
 *
 * `host` and `port` decide the bind address. `dataDir` is the on-disk root
 * for thread JSONL logs and indexes. `runtimeToken` is the bearer token
 * the GUI must send for `/v1/*` requests. The optional `insecure` flag
 * disables the token check (only allowed when the GUI is local).
 */
export const ServeOptionsSchema = z.object({
  configPath: z.string().optional(),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_SERVE_PORT),
  dataDir: z.string().min(1),
  bundledExtensionsDir: z.string().min(1).max(4096).optional(),
  runtimeToken: z.string().default(''),
  apiKey: z.string().default(''),
  credentialSourceId: z.string().min(1).max(256).optional(),
  baseUrl: z.string().default('https://api.deepseek.com/beta'),
  modelProxyUrl: z.string().default(''),
  endpointFormat: z.preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS)).default(DEFAULT_MODEL_ENDPOINT_FORMAT),
  retry: ModelRequestRetryConfigSchema.optional(),
  model: z.string().default(DEFAULT_SERVE_MODEL),
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  tokenEconomyMode: z.boolean().default(false),
  tokenEconomy: TokenEconomyConfigSchema.optional(),
  toolOutputLimits: ToolOutputLimitsConfigSchema.default(DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG),
  insecure: z.boolean().default(false),
  storage: StorageConfigSchema.default(DEFAULT_STORAGE_CONFIG),
  observability: ObservabilityConfigSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  providers: z.record(z.string().min(1), ServeProviderConfigSchema).optional(),
  models: ModelConfigSchema.optional(),
  contextCompaction: ContextCompactionConfigSchema.optional(),
  runtime: RuntimeTuningConfigSchema.optional(),
  roles: RolesConfigSchema.optional(),
  capabilities: KunCapabilitiesConfig.default(DEFAULT_KUN_CAPABILITIES_CONFIG),
  hooks: HooksConfigSchema.optional(),
  quality: QualityConfigSchema.optional()
}).superRefine((value, ctx) => {
  if (value.insecure && !isLoopbackHost(value.host)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['insecure'],
      message: '--insecure is allowed only with a loopback host'
    })
  }
})
export type ServeOptions = z.infer<typeof ServeOptionsSchema>

export const DEFAULT_SERVE_OPTIONS: ServeOptions = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/beta',
  modelProxyUrl: '',
  endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
  model: DEFAULT_SERVE_MODEL,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  tokenEconomyMode: false,
  toolOutputLimits: DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG,
  insecure: false,
  storage: DEFAULT_STORAGE_CONFIG,
  capabilities: DEFAULT_KUN_CAPABILITIES_CONFIG
}
