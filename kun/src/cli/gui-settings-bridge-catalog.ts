import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { z } from 'zod'
import {
  KUN_CONFIG_FILENAME,
  ModelConfigSchema,
  KunServeConfigSchema,
  type ModelConfig,
  type KunServeConfig,
  type ServeProviderConfig
} from '../config/kun-config.js'
import {
  ModelCapabilityMetadata,
  type ModelCapabilityMetadata as ModelCapability
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  type ModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import {
  ModelConnectionSnapshotSchema,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import {
  ApprovalReviewerSchema,
  ApprovalPolicySchema,
  SandboxModeSchema,
  type ApprovalReviewer,
  type ApprovalPolicy,
  type SandboxMode
} from '../contracts/policy.js'
import {
  RuntimeConfigApplyRequest,
  type RuntimeConfigApplyRequest as RuntimeConfigApplyPayload
} from '../contracts/runtime-config.js'
import {
  RuntimeInfoResponse,
  type RuntimeInfoResponse as RuntimeInfo
} from '../contracts/runtime-info.js'
import { modelCapabilitiesForProviderModel } from '../loop/model-context-profile.js'
import { readRuntimeDiscovery } from '../server/runtime-discovery.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import {
  withRuntimeDataDirConfigWriter,
  type RuntimeDataDirWriterAuthority
} from '../server/runtime-data-dir-lease.js'

import {
  expandConfiguredDataDir,
  fetchLegacyGuiRuntimeInfo,
  guiProviderPresetId,
  guiProviderPresetMode,
  guiSettingsCandidates,
  httpUrl,
  isRecordValue,
  legacyAuthType,
  uniqueModels
} from './gui-settings-bridge-sync.js'
import {
  assertSupportedGuiSettingsVersion,
  NewerGuiSettingsSchemaError
} from './gui-settings-schema.js'

export const MAX_GUI_SETTINGS_BYTES = 32 * 1024 * 1024
export const LEGACY_PROVIDER_SOURCE_PREFIX = 'settings:provider:'
export const GUI_PROVIDER_KINDS = [
  'http',
  'agent-sdk',
  'antigravity-cli',
  'cursor-sdk',
  'gemini-cli-api',
  'gemini-code-assist'
] as const

export const GuiModelProfileSchema = ModelCapabilityMetadata.omit({ id: true }).extend({
  aliases: z.array(z.string().min(1).max(512)).max(100).optional()
})

export const GuiProviderSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120).optional(),
  presetSource: z.object({
    presetId: z.string().min(1).max(128),
    mode: z.enum(['api', 'token-plan'])
  }).optional(),
  baseUrl: z.string().max(2_048).default(''),
  endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).default(DEFAULT_MODEL_ENDPOINT_FORMAT),
  kind: z.enum(GUI_PROVIDER_KINDS).default('http'),
  models: z.array(z.string().min(1).max(512)).max(500).default([]),
  modelProfiles: z.record(z.string().min(1).max(512), z.unknown()).optional()
})

export const GuiSharedSettingsSchema = z.object({
  version: z.number().int().min(1).optional(),
  provider: z.object({
    // Provider transports evolve independently of the CLI compatibility
    // reader. Parse entries below so one future/invalid provider cannot make
    // this current settings file lose to an older candidate.
    providers: z.array(z.unknown()).max(500).default([])
  }).default({ providers: [] }),
  agents: z.object({
    kun: z.object({
      dataDir: z.string().min(1).max(4_096),
      model: z.string().max(512).default(''),
      providerId: z.string().max(128).default(''),
      port: z.number().int().min(1).max(65_535).default(18899),
      runtimeToken: z.string().max(64 * 1024).default(''),
      approvalPolicy: ApprovalPolicySchema.optional(),
      sandboxMode: SandboxModeSchema.optional(),
      approvalReviewer: ApprovalReviewerSchema.optional()
    })
  })
})

export type GuiProviderCatalog = Omit<z.infer<typeof GuiProviderSchema>, 'modelProfiles'> & {
  modelProfiles?: Record<string, z.infer<typeof GuiModelProfileSchema>>
}

export type GuiSharedSettings = {
  settingsPath: string
  dataDir: string
  defaultModel: string
  defaultProviderId: string
  defaultApprovalPolicy?: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  providers: GuiProviderCatalog[]
  /** Used only to detect an older GUI runtime that has no discovery record. */
  legacyRuntimePort: number
  /** Secret-bearing compatibility value: never persist, log, or expose in UI. */
  legacyRuntimeToken: string
}

export type GuiConfigSyncResult = {
  changed: boolean
  config: { serve: KunServeConfig; models: ModelConfig }
  applyRequest: RuntimeConfigApplyPayload
}

export type GuiConfigSyncOptions = {
  /** Replace the GUI-managed provider catalog instead of only importing it. */
  authoritative?: boolean
  /** A protected binding has already been committed for every configured provider. */
  stripCredentials?: boolean
  /** Existing in-process Runtime/Manager lease; avoids a conflicting second claim. */
  writerAuthority?: RuntimeDataDirWriterAuthority
  /** Test-only hook for deterministic writer-fence concurrency coverage. */
  afterWriterClaimAcquired?: () => void | Promise<void>
  /** Test-only hook invoked inside writer authority immediately before mutation. */
  beforeConfigWrite?: () => void | Promise<void>
}

export type LegacyGuiRuntimeConnection = {
  baseUrl: string
  runtimeToken: string
  runtimeInfo: RuntimeInfo
}

export async function readGuiSharedSettings(input: {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  homeDir?: string
} = {}): Promise<GuiSharedSettings | null> {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const homeDir = input.homeDir ?? homedir()
  const candidates = guiSettingsCandidates({ env, platform, homeDir })
  for (const settingsPath of candidates) {
    let raw: string
    try {
      const metadata = await stat(settingsPath)
      if (!metadata.isFile() || metadata.size > MAX_GUI_SETTINGS_BYTES) continue
      raw = await readFile(settingsPath, 'utf8')
    } catch {
      continue
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    try {
      assertSupportedGuiSettingsVersion(json, settingsPath)
    } catch (error) {
      // A newer primary schema must fail closed. Falling through to a legacy
      // candidate could silently resurrect stale settings and overwrite data.
      if (error instanceof NewerGuiSettingsSchemaError) return null
      continue
    }
    const parsed = GuiSharedSettingsSchema.safeParse(json)
    if (!parsed.success) continue
    const dataDir = expandConfiguredDataDir(parsed.data.agents.kun.dataDir, platform, homeDir)
    if (!dataDir) continue
    return {
      settingsPath,
      dataDir,
      defaultModel: parsed.data.agents.kun.model.trim(),
      defaultProviderId: parsed.data.agents.kun.providerId.trim(),
      ...(parsed.data.agents.kun.approvalPolicy
        ? { defaultApprovalPolicy: parsed.data.agents.kun.approvalPolicy }
        : {}),
      ...(parsed.data.agents.kun.sandboxMode
        ? { defaultSandboxMode: parsed.data.agents.kun.sandboxMode }
        : {}),
      ...(parsed.data.agents.kun.approvalReviewer
        ? { defaultApprovalReviewer: parsed.data.agents.kun.approvalReviewer }
        : {}),
      legacyRuntimePort: parsed.data.agents.kun.port,
      legacyRuntimeToken: parsed.data.agents.kun.runtimeToken,
      providers: parsed.data.provider.providers.flatMap((value) => {
        const provider = GuiProviderSchema.safeParse(value)
        if (!provider.success) return []
        return [{
          ...provider.data,
          id: provider.data.id.trim(),
          name: provider.data.name?.trim() || provider.data.id.trim(),
          baseUrl: provider.data.baseUrl.trim(),
          models: uniqueModels(provider.data.models),
          modelProfiles: parseGuiModelProfiles(provider.data.modelProfiles)
        }]
      })
    }
  }
  return null
}

export async function hasUnpublishedGuiRuntime(
  settings: GuiSharedSettings,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const discovery = await readRuntimeDiscovery(settings.dataDir).catch(() => null)
  if (discovery && await publishedRuntimeIsLive(discovery, fetchImpl)) return false
  return Boolean(await fetchLegacyGuiRuntimeInfo(settings, fetchImpl))
}

export async function publishedRuntimeIsLive(
  discovery: Awaited<ReturnType<typeof readRuntimeDiscovery>>,
  fetchImpl: typeof fetch
): Promise<boolean> {
  if (!discovery) return false
  try {
    const url = new URL(discovery.baseUrl)
    if (
      url.protocol !== 'http:' ||
      !isLoopbackHost(url.hostname) ||
      !isLoopbackHost(discovery.host) ||
      Number(url.port || '80') !== discovery.port
    ) return false
    const response = await fetchImpl(`${discovery.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: discovery.runtimeToken
        ? { authorization: `Bearer ${discovery.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return false
    const info = RuntimeInfoResponse.parse(await response.json())
    return info.instanceId === discovery.instanceId &&
      info.pid === discovery.pid &&
      info.startedAt === discovery.startedAt &&
      info.serviceVersion === discovery.serviceVersion
  } catch {
    return false
  }
}

export async function resolveLegacyGuiRuntime(
  settings: GuiSharedSettings,
  fetchImpl: typeof fetch = fetch
): Promise<LegacyGuiRuntimeConnection | null> {
  if (await readRuntimeDiscovery(settings.dataDir).catch(() => null)) return null
  const body = await fetchLegacyGuiRuntimeInfo(settings, fetchImpl)
  if (!body) return null
  const parsed = RuntimeInfoResponse.safeParse({
    ...body,
    instanceId: typeof body.instanceId === 'string' && body.instanceId
      ? body.instanceId
      : `legacy-gui:${String(body.pid ?? body.startedAt ?? settings.legacyRuntimePort)}`,
    serviceVersion: typeof body.serviceVersion === 'string' && body.serviceVersion
      ? body.serviceVersion
      : 'legacy-gui',
    launchMode: body.launchMode ?? 'gui'
  })
  if (!parsed.success) return null
  return {
    baseUrl: `http://127.0.0.1:${settings.legacyRuntimePort}`,
    runtimeToken: settings.legacyRuntimeToken,
    runtimeInfo: parsed.data
  }
}

export function modelConnectionSnapshotFromGuiSettings(
  settings: GuiSharedSettings
): ModelConnectionSnapshot {
  const catalogs = settings.providers.filter((provider) => provider.id && provider.models.length > 0)
  const defaultProvider = catalogs.find((provider) => provider.id === settings.defaultProviderId) ??
    catalogs.find((provider) => provider.models.includes(settings.defaultModel)) ??
    catalogs[0]
  const defaultModel = defaultProvider
    ? (defaultProvider.models.includes(settings.defaultModel) ? settings.defaultModel : defaultProvider.models[0])
    : undefined
  return ModelConnectionSnapshotSchema.parse({
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: 0,
    providers: catalogs.map((provider) => ({
      id: provider.id,
      accountId: `account:${provider.id}`,
      name: provider.name ?? provider.id,
      presetSource: guiProviderPresetId(provider),
      ...(guiProviderPresetMode(provider) ? { presetMode: guiProviderPresetMode(provider) } : {}),
      kind: provider.kind,
      authType: legacyAuthType(provider),
      ...(httpUrl(provider.baseUrl) ? { baseUrl: provider.baseUrl } : {}),
      endpointFormat: provider.endpointFormat,
      useProxy: false,
      configured: true,
      models: provider.models,
      modelCapabilities: Object.fromEntries(
        provider.models.map((model) => [model, guiModelCapability(provider, model)])
      ),
      selectedModel: provider.id === defaultProvider?.id ? defaultModel : provider.models[0]
    })),
    ...(defaultProvider
      ? {
          defaultProviderId: defaultProvider.id,
          defaultAccountId: `account:${defaultProvider.id}`,
          ...(defaultModel ? { defaultModel } : {})
        }
      : {}),
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  })
}

export function guiModelCapability(
  provider: GuiProviderCatalog,
  model: string
): ModelCapability {
  const configured = guiModelProfile(provider, model)
  const configuredCapability: Partial<Omit<ModelCapability, 'id'>> = configured
    ? (() => {
        const { aliases: _aliases, ...profile } = configured
        return profile
      })()
    : {}
  const builtIn = modelCapabilitiesForProviderModel({
    providerId: provider.id,
    presetSource: guiProviderPresetId(provider),
    baseUrl: provider.baseUrl,
    kind: provider.kind,
    model
  })
  const reasoning = shouldUseBuiltInReasoning(
    provider,
    model,
    configuredCapability.reasoning,
    builtIn.reasoning
  )
    ? builtIn.reasoning
    : configuredCapability.reasoning ?? builtIn.reasoning
  return ModelCapabilityMetadata.parse({
    ...builtIn,
    ...configuredCapability,
    id: model,
    ...(reasoning ? { reasoning } : {})
  })
}

export function parseGuiModelProfiles(
  input: Record<string, unknown> | undefined
): Record<string, z.infer<typeof GuiModelProfileSchema>> | undefined {
  if (!input) return undefined
  const profiles = Object.fromEntries(Object.entries(input).flatMap(([model, value]) => {
    const parsed = GuiModelProfileSchema.safeParse(value)
    return parsed.success ? [[model.trim().toLowerCase(), parsed.data]] : []
  }))
  return Object.keys(profiles).length > 0 ? profiles : undefined
}

export function guiModelProfile(
  provider: GuiProviderCatalog,
  model: string
): z.infer<typeof GuiModelProfileSchema> | undefined {
  const profiles = provider.modelProfiles
  if (!profiles) return undefined
  return profiles[model] ?? profiles[model.trim().toLowerCase()]
}

export function shouldUseBuiltInReasoning(
  provider: Pick<GuiProviderCatalog, 'id' | 'endpointFormat'>,
  model: string,
  configured: ModelCapability['reasoning'],
  builtIn: ModelCapability['reasoning']
): boolean {
  const providerId = provider.id.toLowerCase()
  const normalizedModel = model.trim().toLowerCase()
  const knownChatResponsesMismatch =
    provider.endpointFormat === 'chat_completions' &&
    configured?.requestProtocol === 'openai-responses' &&
    builtIn?.requestProtocol === 'openai-chat-completions' &&
    (
      (providerId.includes('kimi-code') && normalizedModel === 'k3') ||
      (providerId.includes('opencode-go') && normalizedModel.endsWith('grok-4.5'))
    )
  return Boolean(
    knownChatResponsesMismatch ||
    (
      configured &&
      builtIn &&
      builtIn.requestProtocol !== 'none' &&
      configured.requestProtocol === 'none' &&
      configured.defaultEffort === 'auto' &&
      configured.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
    )
  )
}

export function projectGuiModelProfiles(
  existing: unknown,
  capabilities: Record<string, ModelCapability> | undefined
): Record<string, z.infer<typeof GuiModelProfileSchema>> {
  const current = isRecordValue(existing) ? existing : {}
  const projected: Record<string, z.infer<typeof GuiModelProfileSchema>> = {}
  for (const [model, profile] of Object.entries(current)) {
    const parsed = GuiModelProfileSchema.safeParse(profile)
    if (parsed.success) projected[model] = parsed.data
  }
  if (!capabilities) return projected
  for (const [model, capability] of Object.entries(capabilities)) {
    const { id: _id, ...profile } = capability
    projected[model] = GuiModelProfileSchema.parse({
      ...(projected[model] ?? {}),
      ...profile
    })
  }
  return projected
}

export function guiModelProfilesForConfig(
  settings: GuiSharedSettings
): Record<string, z.infer<typeof GuiModelProfileSchema>> {
  const profiles: Record<string, z.infer<typeof GuiModelProfileSchema>> = {}
  for (const provider of settings.providers) {
    for (const model of provider.models) {
      const capability = guiModelCapability(provider, model)
      const configured = guiModelProfile(provider, model)
      const { id: _id, ...profile } = capability
      profiles[model.trim().toLowerCase()] = {
        ...profile,
        ...(configured?.aliases ? { aliases: [...configured.aliases] } : {})
      }
    }
  }
  return profiles
}

/**
 * Persist the registry's secret-free compatibility projection for GUI builds
 * that still read provider metadata from kun-settings.json. Existing rich
 * capability fields are retained by provider id, but every ordinary apiKey
 * field touched by this projection is cleared.
 */
