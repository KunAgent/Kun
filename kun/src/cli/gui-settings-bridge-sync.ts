import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { z } from 'zod'
import { resolveProviderCatalogSource } from '@kun/provider-catalog'
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
  LEGACY_PROVIDER_SOURCE_PREFIX,
  MAX_GUI_SETTINGS_BYTES,
  guiModelCapability,
  guiModelProfilesForConfig,
  projectGuiModelProfiles
} from './gui-settings-bridge-catalog.js'
import type {
  GuiConfigSyncOptions,
  GuiConfigSyncResult,
  GuiProviderCatalog,
  GuiSharedSettings
} from './gui-settings-bridge-catalog.js'

export async function projectModelConnectionsToGuiSettings(
  settings: GuiSharedSettings,
  snapshot: ModelConnectionSnapshot,
  options: { protectedProviderIds?: ReadonlySet<string> } = {}
): Promise<GuiSharedSettings> {
  const metadata = await stat(settings.settingsPath)
  if (!metadata.isFile() || metadata.size > MAX_GUI_SETTINGS_BYTES) {
    throw new Error(`GUI settings file is unavailable: ${settings.settingsPath}`)
  }
  const parsed = JSON.parse(await readFile(settings.settingsPath, 'utf8')) as unknown
  if (!isRecordValue(parsed)) throw new Error('GUI settings must be a JSON object')
  const providerSettings = isRecordValue(parsed.provider) ? { ...parsed.provider } : {}
  const existingProviders = Array.isArray(providerSettings.providers)
    ? providerSettings.providers.filter(isRecordValue)
    : []
  const existingById = new Map(existingProviders
    .map((provider) => [typeof provider.id === 'string' ? provider.id.trim() : '', provider] as const)
    .filter(([id]) => Boolean(id)))
  const providers = snapshot.providers.map((profile) => {
    const existing = existingById.get(profile.id) ?? {}
    const source = resolveProviderCatalogSource({
      id: profile.id,
      presetSource: profile.presetSource,
      presetMode: profile.presetMode
    }) ?? existingGuiPresetSource(existing)
    return {
      ...existing,
      id: profile.id,
      name: profile.name,
      ...(source ? { presetSource: { presetId: source.presetSource, mode: source.presetMode } } : {}),
      apiKey: (options.protectedProviderIds ? options.protectedProviderIds.has(profile.id) : true)
        ? ''
        : typeof existing.apiKey === 'string' ? existing.apiKey : '',
      baseUrl: profile.baseUrl ?? '',
      endpointFormat: profile.endpointFormat,
      kind: profile.kind,
      models: [...profile.models],
      modelProfiles: projectGuiModelProfiles(existing.modelProfiles, profile.modelCapabilities)
    }
  })
  const agents = isRecordValue(parsed.agents) ? { ...parsed.agents } : {}
  const kun = isRecordValue(agents.kun) ? { ...agents.kun } : {}
  const next = {
    ...parsed,
    provider: {
      ...providerSettings,
      apiKey: snapshot.defaultProviderId && (options.protectedProviderIds
        ? options.protectedProviderIds.has(snapshot.defaultProviderId)
        : true)
        ? ''
        : typeof providerSettings.apiKey === 'string' ? providerSettings.apiKey : '',
      providers
    },
    agents: {
      ...agents,
      kun: {
        ...kun,
        providerId: snapshot.defaultProviderId ?? '',
        model: snapshot.defaultModel ?? ''
      }
    }
  }
  await writeAtomicOwnerOnly(settings.settingsPath, `${JSON.stringify(next, null, 2)}\n`)
  return {
    ...settings,
    defaultProviderId: snapshot.defaultProviderId ?? '',
    defaultModel: snapshot.defaultModel ?? '',
    providers: snapshot.providers.map((profile) => {
      const source = resolveProviderCatalogSource({
        id: profile.id,
        presetSource: profile.presetSource,
        presetMode: profile.presetMode
      })
      return {
        id: profile.id,
        name: profile.name,
        ...(source ? { presetSource: { presetId: source.presetSource, mode: source.presetMode } } : {}),
        baseUrl: profile.baseUrl ?? '',
        endpointFormat: profile.endpointFormat,
        kind: profile.kind,
        models: [...profile.models],
        modelProfiles: projectGuiModelProfiles(undefined, profile.modelCapabilities)
      }
    })
  }
}

/**
 * Keep GUI-compatible defaults aligned with the registry without projecting
 * catalogs or touching provider credential fields.
 */
export async function projectModelSelectionToGuiSettings(
  settings: GuiSharedSettings,
  snapshot: Pick<ModelConnectionSnapshot, 'defaultProviderId' | 'defaultModel'>
): Promise<GuiSharedSettings> {
  const providerId = snapshot.defaultProviderId ?? ''
  const model = snapshot.defaultModel ?? ''
  if (settings.defaultProviderId === providerId && settings.defaultModel === model) {
    return settings
  }
  const metadata = await stat(settings.settingsPath)
  if (!metadata.isFile() || metadata.size > MAX_GUI_SETTINGS_BYTES) {
    throw new Error(`GUI settings file is unavailable: ${settings.settingsPath}`)
  }
  const parsed = JSON.parse(await readFile(settings.settingsPath, 'utf8')) as unknown
  if (!isRecordValue(parsed)) throw new Error('GUI settings must be a JSON object')
  const agents = isRecordValue(parsed.agents) ? { ...parsed.agents } : {}
  const kun = isRecordValue(agents.kun) ? { ...agents.kun } : {}
  const currentProviderId = typeof kun.providerId === 'string' ? kun.providerId : ''
  const currentModel = typeof kun.model === 'string' ? kun.model : ''
  if (currentProviderId !== providerId || currentModel !== model) {
    await writeAtomicOwnerOnly(settings.settingsPath, `${JSON.stringify({
      ...parsed,
      agents: {
        ...agents,
        kun: {
          ...kun,
          providerId,
          model
        }
      }
    }, null, 2)}\n`)
  }
  return {
    ...settings,
    defaultProviderId: providerId,
    defaultModel: model
  }
}

export async function fetchLegacyGuiRuntimeInfo(
  settings: GuiSharedSettings,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(
      `http://127.0.0.1:${settings.legacyRuntimePort}/v1/runtime/info`,
      {
        headers: settings.legacyRuntimeToken
          ? { authorization: `Bearer ${settings.legacyRuntimeToken}` }
          : {},
        signal: AbortSignal.timeout(2_000)
      }
    )
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const record = body as Record<string, unknown>
    return typeof record.dataDir === 'string' && samePath(record.dataDir, settings.dataDir)
      ? record
      : null
  } catch {
    return null
  }
}

export async function syncGuiProviderCatalogToConfig(
  dataDir: string,
  settings: GuiSharedSettings,
  options: GuiConfigSyncOptions = {}
): Promise<GuiConfigSyncResult | null> {
  if (!samePath(dataDir, settings.dataDir)) return null
  const synchronize = async (): Promise<GuiConfigSyncResult> => {
    const configPath = join(dataDir, KUN_CONFIG_FILENAME)
    const existing = await readConfigDocument(configPath)
    const parsedServe = KunServeConfigSchema.safeParse(existing.serve ?? {})
    if (!parsedServe.success) {
      throw new Error(
        `invalid serve config at ${configPath}: ${parsedServe.error.issues.map((issue) => issue.message).join('; ')}`
      )
    }
    const existingServe = parsedServe.data
    const providers: Record<string, ServeProviderConfig> = options.authoritative
      ? {}
      : { ...(existingServe.providers ?? {}) }

    for (const provider of settings.providers) {
      if (!provider.id || provider.models.length === 0) continue
      const current = providers[provider.id]
      const kind = provider.kind ?? current?.kind ?? 'http'
      const baseUrl = provider.baseUrl || current?.baseUrl
      if (kind !== 'agent-sdk' && !baseUrl) continue
      const selectedModel = preferredModel({
        providerId: provider.id,
        models: provider.models,
        current: current?.selectedModel,
        defaultProviderId: settings.defaultProviderId,
        defaultModel: settings.defaultModel
      })
      providers[provider.id] = {
        ...current,
        kind,
        apiKey: options.stripCredentials ? '' : current?.apiKey ?? '',
        credentialSourceId: current?.credentialSourceId ?? credentialSourceId(provider.id),
        presetSource: guiProviderPresetId(provider),
        ...(guiProviderPresetMode(provider) ? { presetMode: guiProviderPresetMode(provider) } : {}),
        authType: legacyAuthType(provider),
        ...(baseUrl ? { baseUrl } : {}),
        endpointFormat: provider.endpointFormat ?? current?.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
        models: provider.models,
        modelCapabilities: Object.fromEntries(
          provider.models.map((model) => [model, guiModelCapability(provider, model)])
        ),
        ...(selectedModel ? { selectedModel } : {})
      }
    }

    const inferredDefaultProviderId = inferDefaultProviderId(settings, existingServe, providers)
    const defaultProvider = inferredDefaultProviderId ? providers[inferredDefaultProviderId] : undefined
    const defaultModel = preferredModel({
      providerId: inferredDefaultProviderId,
      models: defaultProvider?.models ?? [],
      current: existingServe.model,
      defaultProviderId: settings.defaultProviderId || inferredDefaultProviderId,
      defaultModel: settings.defaultModel
    })
    const nextServe = KunServeConfigSchema.parse({
      ...existingServe,
      ...(settings.defaultApprovalPolicy
        ? { approvalPolicy: settings.defaultApprovalPolicy }
        : {}),
      ...(settings.defaultSandboxMode
        ? { sandboxMode: settings.defaultSandboxMode }
        : {}),
      ...(settings.defaultApprovalReviewer
        ? { approvalReviewer: settings.defaultApprovalReviewer }
        : {}),
      ...(options.authoritative ? { providers: {}, credentialSourceId: undefined } : {}),
      ...(options.stripCredentials ? { apiKey: '' } : {}),
      providers,
      ...(defaultProvider && inferredDefaultProviderId
        ? {
            credentialSourceId: credentialSourceId(inferredDefaultProviderId),
            ...(defaultProvider.baseUrl ? { baseUrl: defaultProvider.baseUrl } : {}),
            endpointFormat: defaultProvider.endpointFormat ?? existingServe.endpointFormat,
            ...(defaultModel ? { model: defaultModel } : {})
          }
        : {})
    })
    const existingModels = isRecordValue(existing.models) ? existing.models : {}
    const existingProfiles = isRecordValue(existingModels.profiles)
      ? existingModels.profiles
      : {}
    const nextModels = ModelConfigSchema.parse({
      ...existingModels,
      profiles: {
        ...existingProfiles,
        ...guiModelProfilesForConfig(settings)
      }
    })
    // Preserve capability sections written by a newer GUI. This bridge owns
    // only serve/provider metadata and must not erase forward-compatible fields.
    const nextDocument = { ...existing, serve: nextServe, models: nextModels }
    const nextText = `${JSON.stringify(nextDocument, null, 2)}\n`
    let currentText = ''
    try {
      currentText = await readFile(configPath, 'utf8')
    } catch {
      // The first standalone TUI launch creates the shared config.
    }
    const changed = currentText !== nextText
    if (changed) {
      await options.beforeConfigWrite?.()
      await writeAtomicOwnerOnly(configPath, nextText)
    }
    return {
      changed,
      config: { serve: nextServe, models: nextModels },
      applyRequest: runtimeApplyRequest(
        nextServe,
        nextModels,
        inferredDefaultProviderId && defaultModel
          ? { providerId: inferredDefaultProviderId, model: defaultModel }
          : undefined
      )
    }
  }

  return withRuntimeDataDirConfigWriter(dataDir, synchronize, {
    ...(options.writerAuthority ? { authority: options.writerAuthority } : {}),
    ...(options.afterWriterClaimAcquired
      ? { afterClaimAcquired: options.afterWriterClaimAcquired }
      : {})
  })
}

export function existingGuiPresetSource(value: Record<string, unknown>) {
  const raw = value.presetSource
  if (!isRecordValue(raw)) return null
  const presetSource = typeof raw.presetId === 'string' ? raw.presetId : undefined
  const presetMode = raw.mode === 'api' || raw.mode === 'token-plan' ? raw.mode : undefined
  return resolveProviderCatalogSource({
    id: typeof value.id === 'string' ? value.id : undefined,
    presetSource,
    presetMode
  })
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function guiSettingsCandidates(input: {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  homeDir: string
}): string[] {
  const explicit = input.env.KUN_GUI_SETTINGS_PATH?.trim()
  if (explicit) return [expandTilde(explicit, input.homeDir)]
  if (input.platform === 'darwin') {
    return guiSettingsUnder(join(input.homeDir, 'Library', 'Application Support'))
  }
  if (input.platform === 'win32') {
    const appData = input.env.APPDATA?.trim()
    return appData ? guiSettingsUnder(appData) : []
  }
  const configRoot = input.env.XDG_CONFIG_HOME?.trim() || join(input.homeDir, '.config')
  return guiSettingsUnder(configRoot)
}

export function guiSettingsUnder(root: string): string[] {
  return ['Kun', 'DeepSeek GUI', 'deepseek-gui'].flatMap((name) => [
    join(root, name, 'kun-settings.json'),
    join(root, name, 'deepseek-gui-settings.json')
  ])
}

export function expandConfiguredDataDir(
  value: string,
  platform: NodeJS.Platform,
  homeDir: string
): string | null {
  const expanded = expandTilde(value.trim(), homeDir)
  const absolute = platform === 'win32' ? win32.isAbsolute(expanded) : isAbsolute(expanded)
  return absolute ? expanded : null
}

export function expandTilde(value: string, homeDir: string): string {
  if (value === '~') return homeDir
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homeDir, value.slice(2).replace(/\\/g, '/'))
  }
  return value
}

export function inferDefaultProviderId(
  settings: GuiSharedSettings,
  serve: KunServeConfig,
  providers: Record<string, ServeProviderConfig>
): string {
  if (settings.defaultProviderId && providers[settings.defaultProviderId]) {
    return settings.defaultProviderId
  }
  const source = serve.credentialSourceId?.trim() ?? ''
  if (source.startsWith(LEGACY_PROVIDER_SOURCE_PREFIX)) {
    const providerId = source.slice(LEGACY_PROVIDER_SOURCE_PREFIX.length).trim()
    if (providers[providerId]) return providerId
  }
  const matchingModel = settings.defaultModel
    ? Object.entries(providers).find(([, provider]) => provider.models?.includes(settings.defaultModel))?.[0]
    : undefined
  return matchingModel ?? Object.keys(providers)[0] ?? ''
}

export function preferredModel(input: {
  providerId: string
  models: readonly string[]
  current?: string
  defaultProviderId: string
  defaultModel: string
}): string | undefined {
  if (
    input.providerId === input.defaultProviderId &&
    input.defaultModel &&
    input.models.includes(input.defaultModel)
  ) return input.defaultModel
  if (input.current && input.models.includes(input.current)) return input.current
  return input.models[0]
}

export function credentialSourceId(providerId: string): string {
  return `${LEGACY_PROVIDER_SOURCE_PREFIX}${providerId}`
}

export function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
}

export function legacyAuthType(provider: GuiProviderCatalog): 'api-key' | 'subscription' {
  const source = guiProviderCatalogSource(provider)
  return source?.preset.authType === 'subscription' ||
    provider.kind === 'agent-sdk' ||
    provider.kind === 'antigravity-cli' ||
    provider.kind === 'cursor-sdk'
    ? 'subscription'
    : 'api-key'
}

export function guiProviderCatalogSource(provider: GuiProviderCatalog) {
  return resolveProviderCatalogSource({
    id: provider.id,
    presetSource: provider.presetSource?.presetId,
    presetMode: provider.presetSource?.mode
  })
}

export function guiProviderPresetId(provider: GuiProviderCatalog): string {
  return guiProviderCatalogSource(provider)?.presetSource ??
    (provider.presetSource?.presetId.trim() || provider.id)
}

export function guiProviderPresetMode(provider: GuiProviderCatalog): 'api' | 'token-plan' | undefined {
  return guiProviderCatalogSource(provider)?.presetMode ?? provider.presetSource?.mode
}

export function httpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

export function runtimeApplyRequest(
  serve: KunServeConfig,
  models: ModelConfig,
  modelSelection?: {
    providerId: string
    model: string
  }
): RuntimeConfigApplyPayload {
  const {
    host: _host,
    port: _port,
    dataDir: _dataDir,
    runtimeToken: _runtimeToken,
    insecure: _insecure,
    storage: _storage,
    ...hotServe
  } = serve
  void _host
  void _port
  void _dataDir
  void _runtimeToken
  void _insecure
  void _storage
  return RuntimeConfigApplyRequest.parse({
    serve: hotServe,
    models,
    ...(modelSelection ? { modelSelection } : {})
  })
}

export async function readConfigDocument(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (String((error as { code?: unknown })?.code ?? '') === 'ENOENT') return {}
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid Kun config object at ${path}`)
  }
  return value as Record<string, unknown>
}

export async function writeAtomicOwnerOnly(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700).catch(() => undefined)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporary, path)
    await chmod(path, 0o600).catch(() => undefined)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
