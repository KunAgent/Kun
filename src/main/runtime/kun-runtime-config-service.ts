import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ContextCompactionConfigSchema,
  KunConfigSchema,
  KunServeConfigSchema,
  ModelConfigSchema,
  QualityConfigSchema,
  RolesConfigSchema,
  RuntimeTuningConfigSchema,
  type KunConfig
} from '../../../kun/src/config/kun-config.js'
import {
  RuntimeConfigApplyRequest,
  type RuntimeConfigApplyRequest as RuntimeConfigApplyPayload
} from '../../../kun/src/contracts/runtime-config.js'
import { HooksConfigSchema } from '../../../kun/src/hooks/hook-config.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  ImageGenCapabilityConfig,
  InstructionsCapabilityConfig,
  McpCapabilityConfig,
  MemoryCapabilityConfig,
  MusicGenCapabilityConfig,
  SkillsCapabilityConfig,
  SpeechGenCapabilityConfig,
  SubagentsCapabilityConfig,
  VideoGenCapabilityConfig,
  WebCapabilityConfig
} from '../../../kun/src/contracts/capabilities.js'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  getKunRuntimeSettings,
  resolveKunRuntimeSettings,
  resolveModelProviderProxyUrl,
  type AppSettingsV1,
  type KunRuntimeSettingsV1
} from '../../shared/app-settings'
import { resolveCodexOAuthApiKey } from '../codex-auth'
import {
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from '../claw-schedule-mcp-config'
import {
  computerUseConfigForRuntime,
  imageGenConfigForRuntime,
  musicGenConfigForRuntime,
  qualityConfigForRuntime,
  runtimeTuningConfigForRuntime,
  speechGenConfigForRuntime,
  videoGenConfigForRuntime
} from './kun-runtime-capability-config'
import {
  buildGuiScheduleKunMcpServer,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  readGuiManagedMcpServers,
  readJsonObjectIfExists,
  skillCapabilityConfigForRuntime
} from './kun-runtime-mcp-config'
import {
  contextCompactionConfigForRuntime,
  modelConfigForRuntime,
  providersConfigForRuntime,
  rolesConfigForRuntime,
  storageConfigForRuntime,
  tokenEconomyConfigForRuntime,
  toolOutputLimitsConfigForRuntime
} from './kun-runtime-model-config'
import { subagentProfilesForRuntime } from './kun-runtime-subagent-config'
import {
  LEGACY_RUNTIME_OVERRIDE_SOURCE_ID,
  legacyProviderCredentialSourceId
} from '../legacy-provider-settings-migration'
import {
  approvedProjectMcpServers,
  stripGeneratedProjectMcpServers
} from '../services/project-config-service'

export type ManagedRuntimeHotApplyResult = 'applied' | 'restart_required' | 'failed'

export type ManagedRuntimeHotApplyResponse = {
  result: ManagedRuntimeHotApplyResult
  message: string
}

export async function syncGuiManagedKunConfig(
  dataDir: string,
  runtime: KunRuntimeConfigSettings,
  options?: {
    scheduleMcp?: { settings: AppSettingsV1; launch: ClawScheduleMcpLaunchConfig }
    mcpConfigPath?: string
    appSettings?: AppSettingsV1
  }
): Promise<KunConfig> {
  const configPath = join(dataDir, 'config.json')
  const existing = sanitizeKunConfigSections(await readJsonObjectIfExists(configPath))
  const importedMcpServers = stripGeneratedProjectMcpServers(
    await readGuiManagedMcpServers(
      options?.mcpConfigPath ?? resolveKunMcpJsonPath()
    )
  )
  const appSettings = options?.appSettings ?? options?.scheduleMcp?.settings
  const projectMcpServers = appSettings
    ? await approvedProjectMcpServers(appSettings)
    : {}
  const hasImportedEnabledMcpServer = Object.values(importedMcpServers)
    .some((server) => objectValue(server).enabled !== false)
  const serve = objectValue(existing?.serve)
  const capabilities = objectValue(existing?.capabilities)
  const mcp = objectValue(capabilities.mcp)
  const search = objectValue(mcp.search)
  const skills = await skillCapabilityConfigForRuntime(
    objectValue(capabilities.skills),
    appSettings
  )
  const providers = options?.scheduleMcp?.settings
    ? providersConfigForRuntime(options.scheduleMcp.settings)
    : undefined
  const defaultModelProxyUrl = options?.scheduleMcp?.settings
    ? resolveModelProviderProxyUrl(options.scheduleMcp.settings)
    : undefined
  const workflowHooks = buildWorkflowHookEntries(options?.scheduleMcp?.settings.workflow)
  const roles = rolesConfigForRuntime(runtime)
  const next = {
    serve: {
      ...serve,
      storage: storageConfigForRuntime(runtime.storage),
      // Secrets and credential-derived headers are process-local only.
      apiKey: undefined,
      headers: undefined,
      credentialSourceId: options?.scheduleMcp?.settings
        ? defaultCredentialSourceId(options.scheduleMcp.settings)
        : undefined,
      baseUrl: runtime.baseUrl.trim() || undefined,
      endpointFormat: runtime.endpointFormat,
      model: runtime.model.trim() || undefined,
      modelProxyUrl: defaultModelProxyUrl || undefined,
      retry: runtime.retry,
      tokenEconomy: tokenEconomyConfigForRuntime(runtime.tokenEconomy, objectValue(serve.tokenEconomy)),
      toolOutputLimits: toolOutputLimitsConfigForRuntime(runtime.toolOutputLimits),
      ...(providers && Object.keys(providers).length ? { providers } : {})
    },
    models: modelConfigForRuntime(objectValue(existing?.models), runtime.modelProfiles),
    contextCompaction: contextCompactionConfigForRuntime(
      runtime.contextCompaction,
      objectValue(existing?.contextCompaction)
    ),
    runtime: runtimeTuningConfigForRuntime(runtime.runtimeTuning, objectValue(existing?.runtime)),
    quality: qualityConfigForRuntime(runtime.quality, objectValue(existing?.quality)),
    ...(Object.keys(roles).length ? { roles } : {}),
    capabilities: {
      ...capabilities,
      attachments: enabledByDefault(objectValue(capabilities.attachments)),
      web: {
        ...enabledByDefault(objectValue(capabilities.web)),
        fetchEnabled: objectValue(capabilities.web).fetchEnabled === false ? false : true
      },
      skills,
      imageGen: imageGenConfigForRuntime(runtime.imageGeneration, objectValue(capabilities.imageGen)),
      speechGen: speechGenConfigForRuntime(runtime.textToSpeech, objectValue(capabilities.speechGen)),
      musicGen: musicGenConfigForRuntime(runtime.musicGeneration, objectValue(capabilities.musicGen)),
      videoGen: videoGenConfigForRuntime(runtime.videoGeneration, objectValue(capabilities.videoGen)),
      computerUse: computerUseConfigForRuntime(runtime.computerUse, objectValue(capabilities.computerUse)),
      memory: { ...objectValue(capabilities.memory), enabled: runtime.memoryEnabled },
      instructions: {
        ...objectValue(capabilities.instructions),
        enabled: runtime.instructions?.enabled ?? true
      },
      subagents: subagentProfilesForRuntime(runtime.subagents ?? { enabled: true, profiles: [] }),
      mcp: {
        ...mcp,
        ...(options?.scheduleMcp || runtime.mcpSearch.enabled || hasImportedEnabledMcpServer || Object.keys(projectMcpServers).length > 0
          ? { enabled: mcp.enabled === false ? false : true }
          : {}),
        servers: {
          ...stripGeneratedProjectMcpServers(objectValue(mcp.servers)),
          ...importedMcpServers,
          ...projectMcpServers,
          ...(options?.scheduleMcp ? {
            [GUI_SCHEDULE_MCP_SERVER_NAME]: buildGuiScheduleKunMcpServer(
              options.scheduleMcp.settings,
              options.scheduleMcp.launch
            )
          } : {})
        },
        search: { ...search, ...runtime.mcpSearch }
      }
    },
    ...(workflowHooks.length ? { hooks: workflowHooks } : {})
  }
  const parsed = KunConfigSchema.safeParse(next)
  if (!parsed.success) {
    throw new Error(
      `Refusing to write invalid GUI-managed Kun config at ${configPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  if (existing && nextText === `${JSON.stringify(existing, null, 2)}\n`) return parsed.data
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextText, 'utf8')
  return parsed.data
}

function defaultCredentialSourceId(settings: AppSettingsV1): string {
  const storedRuntime = getKunRuntimeSettings(settings)
  if (storedRuntime.apiKey.trim()) return LEGACY_RUNTIME_OVERRIDE_SOURCE_ID
  return legacyProviderCredentialSourceId(storedRuntime.providerId.trim() || DEFAULT_MODEL_PROVIDER_ID)
}

type KunRuntimeConfigSettings = Pick<KunRuntimeSettingsV1,
  'apiKey' | 'baseUrl' | 'endpointFormat' | 'model' | 'mcpSearch' | 'retry' |
  'tokenEconomy' | 'toolOutputLimits' | 'storage' | 'contextCompaction' |
  'runtimeTuning' | 'imageGeneration' | 'textToSpeech' | 'musicGeneration' |
  'videoGeneration' | 'computerUse' | 'modelProfiles' | 'memoryEnabled' |
  'instructions' | 'quality' | 'subagents' | 'smallModel' |
  'smallModelProviderId' | 'smallModelAccountId' |
  'titleModel' | 'titleProviderId' | 'titleAccountId' |
  'summaryModel' | 'summaryProviderId' | 'summaryAccountId' |
  'codeReviewModel' | 'codeReviewProviderId' | 'codeReviewAccountId'
>

/** Pure request projection for the serve runtime's hot-config endpoint. */
export function buildManagedRuntimeHotApplyBody(
  settings: AppSettingsV1,
  config: KunConfig
): RuntimeConfigApplyPayload {
  const runtime = resolveKunRuntimeSettings(settings)
  const serve = config.serve ?? {}
  // Process-owned fields are valid in persisted config, but the hot-apply API
  // deliberately rejects them because changing them requires a restart.
  const hotServe = { ...serve }
  delete hotServe.host
  delete hotServe.port
  delete hotServe.dataDir
  delete hotServe.runtimeToken
  delete hotServe.insecure
  delete hotServe.storage
  const defaultClientApiKey = resolveCodexOAuthApiKey(runtime.apiKey).apiKey
  return RuntimeConfigApplyRequest.parse({
    ...config,
    serve: {
      ...hotServe,
      apiKey: defaultClientApiKey || runtime.apiKey,
      baseUrl: runtime.baseUrl,
      modelProxyUrl: resolveModelProviderProxyUrl(settings),
      endpointFormat: runtime.endpointFormat,
      model: runtime.model,
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode,
      tokenEconomyMode: runtime.tokenEconomyMode,
      tokenEconomy: runtime.tokenEconomy,
      toolOutputLimits: runtime.toolOutputLimits,
      providers: serve.providers ?? {}
    }
  })
}

/** Pure response policy: callers own logging, retry, restart, and status effects. */
export function classifyManagedRuntimeHotApplyResponse(
  status: number,
  ok: boolean,
  text: string
): ManagedRuntimeHotApplyResponse {
  if (status === 404 || status === 405) {
    return { result: 'restart_required', message: 'runtime does not support hot config apply' }
  }
  const parsed = parseResponseObject(text)
  if (ok && parsed?.ok === true) return { result: 'applied', message: '' }
  const message = String(parsed?.message ?? text).trim()
  if (parsed?.code === 'restart_required') {
    return { result: 'restart_required', message }
  }
  return {
    result: 'failed',
    message: message || `Kun hot config apply failed with HTTP ${status}`
  }
}

function parseResponseObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

type SafeParseSchema = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | { success: false }
}

function sanitizeKunConfigSections(
  existing: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!existing) return null
  const hooks = parseKunHooksSection(existing.hooks)
  return {
    serve: parseKunConfigSection(KunServeConfigSchema, existing.serve),
    models: parseKunConfigSection(ModelConfigSchema, existing.models),
    contextCompaction: parseKunConfigSection(ContextCompactionConfigSchema, existing.contextCompaction),
    runtime: parseKunConfigSection(RuntimeTuningConfigSchema, existing.runtime),
    quality: parseKunConfigSection(QualityConfigSchema, existing.quality),
    capabilities: sanitizeCapabilities(existing.capabilities),
    ...('roles' in existing ? { roles: parseKunConfigSection(RolesConfigSchema, existing.roles) } : {}),
    ...(hooks.length ? { hooks } : {})
  }
}

function sanitizeCapabilities(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const schemas: Record<string, SafeParseSchema> = {
    mcp: McpCapabilityConfig,
    web: WebCapabilityConfig,
    instructions: InstructionsCapabilityConfig,
    skills: SkillsCapabilityConfig,
    subagents: SubagentsCapabilityConfig,
    attachments: AttachmentsCapabilityConfig,
    memory: MemoryCapabilityConfig,
    imageGen: ImageGenCapabilityConfig,
    speechGen: SpeechGenCapabilityConfig,
    musicGen: MusicGenCapabilityConfig,
    videoGen: VideoGenCapabilityConfig,
    computerUse: ComputerUseCapabilityConfig
  }
  const next: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(schemas)) {
    if (key in raw) next[key] = parseKunConfigSection(schema, raw[key])
  }
  return next
}

function parseKunConfigSection(schema: SafeParseSchema, value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const parsed = schema.safeParse(raw)
  if (parsed.success) return objectValue(parsed.data)

  // Older GUI/runtime versions may leave a newly introduced top-level key in
  // the config. A strict schema should reject that key, but dropping the
  // entire section also discards valid credentials and endpoint settings.
  // Retry with only keys known by the object schema; invalid known values are
  // still rejected by the normal schema and therefore fail closed.
  const shape = schemaShape(schema)
  if (!shape) return {}
  const known = Object.fromEntries(Object.keys(shape).flatMap((key) =>
    key in raw ? [[key, raw[key]] as const] : []
  ))
  const sanitized = schema.safeParse(known)
  if (sanitized.success) return objectValue(sanitized.data)

  // A known nested object may itself contain an obsolete key. Validate each
  // top-level value independently so one stale nested option cannot discard
  // unrelated credentials or endpoint fields from the section.
  const validEntries = Object.entries(known).flatMap(([key, entry]) => {
    const parsedEntry = schema.safeParse({ [key]: entry })
    return parsedEntry.success ? [[key, objectValue(parsedEntry.data)[key]] as const] : []
  })
  return Object.fromEntries(validEntries)
}

function schemaShape(schema: SafeParseSchema): Record<string, unknown> | undefined {
  const candidate = schema as SafeParseSchema & {
    shape?: unknown
    def?: unknown
    _def?: unknown
  }
  for (const container of [candidate, candidate.def, candidate._def]) {
    if (!container || typeof container !== 'object') continue
    const rawShape = 'shape' in container ? (container as { shape?: unknown }).shape : undefined
    const shape = typeof rawShape === 'function' ? rawShape() : rawShape
    if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
      return shape as Record<string, unknown>
    }
  }
  return undefined
}

function parseKunHooksSection(value: unknown): unknown[] {
  const parsed = HooksConfigSchema.safeParse(Array.isArray(value) ? value : [])
  return parsed.success ? parsed.data : []
}

function buildWorkflowHookEntries(workflow: AppSettingsV1['workflow'] | undefined): unknown[] {
  if (!workflow) return []
  const baseUrl = `http://127.0.0.1:${workflow.webhookPort}`
  const secret = workflow.webhookSecret.trim()
  return (workflow.hookTriggers ?? [])
    .filter((trigger) => trigger.enabled && trigger.workflowId)
    .map((trigger) => ({
      phase: trigger.phase,
      ...(trigger.toolNames.length ? { toolNames: trigger.toolNames } : {}),
      workflow: trigger.workflowId,
      mode: trigger.mode,
      baseUrl,
      ...(secret ? { secret } : {}),
      ...(trigger.timeoutMs > 0 ? { timeoutMs: trigger.timeoutMs } : {})
    }))
}

function enabledByDefault(existing: Record<string, unknown>): Record<string, unknown> {
  return { ...existing, enabled: existing.enabled === false ? false : true }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
