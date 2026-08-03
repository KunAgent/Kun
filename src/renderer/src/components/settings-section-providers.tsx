import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import type {
  AppSettingsPatch,
  ImageGenerationProtocol,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  MusicGenerationProtocol,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderPresetMode,
  ModelProviderMusicCapabilityV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from '@shared/app-settings'
import {
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_ENDPOINT_FORMATS,
  MODEL_PROVIDER_PRESETS,
  defaultMiniMaxMediaGenerationKunPatch,
  defaultModelRequestRetrySettings,
  defaultModelProviderSettings,
  isMultiAccountProviderPreset,
  modelProviderPresetAccountCount,
  modelProviderPresetAccountProfile,
  modelProviderPresetProfile,
  modelProviderRequiresApiKey,
  modelSupportsImageInput,
  modelProviderTokenPlanProfile,
  normalizeModelProviderId,
  resolveModelProviderPresetSource,
  tokenPlanProviderId
} from '@shared/app-settings'
import type {
  ModelProviderPreset,
  ModelProviderSubscriptionRegion
} from '@shared/model-provider-presets'
import type {
  AntigravitySubscriptionModelCatalog,
  CursorSubscriptionModel,
  ModelsDevCatalogResult,
  ModelProviderProbeResult
} from '@shared/kun-gui-api'
import {
  AlertCircle,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Download,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Mic,
  Music2,
  PlugZap,
  Plus,
  Route,
  Search,
  ServerCog,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import {
  InlineNoticeView,
  SecretInput,
  SettingsSubTabs,
  SettingsTabPanel,
  SettingsTabs,
  Toggle,
  type InlineNotice
} from './settings-controls'

type SharedModelConnection = {
  id: string
  accountId: string
  name: string
  presetSource?: string
  kind: 'http' | 'agent-sdk' | 'antigravity-cli' | 'cursor-sdk' | 'gemini-code-assist'
  authType: 'api-key' | 'oauth' | 'subscription'
  baseUrl?: string
  endpointFormat: ModelEndpointFormat
  configured: boolean
  models: string[]
  modelCapabilities?: Record<string, Omit<ModelProviderModelProfileV1, 'aliases'> & { id: string }>
  selectedModel?: string
}

type SharedModelConnectionsSnapshot = {
  schemaVersion: 1
  revision: number
  providers: SharedModelConnection[]
  defaultProviderId?: string
  defaultAccountId?: string
  defaultModel?: string
  proxy?: { enabled: boolean; url: string }
  routePools?: ModelProviderSettingsV1['routePools']
  localModelGateway?: { enabled: boolean }
}

export function sharedProviderSetupNeedsApiKey(
  providers: readonly ModelProviderProfileV1[],
  snapshot: SharedModelConnectionsSnapshot | null
): boolean {
  if (!snapshot) return false
  return !providers.some((provider) =>
    !modelProviderRequiresApiKey(provider) ||
    Boolean(provider.apiKey.trim()) ||
    snapshot.providers.some((connection) =>
      connection.id === provider.id && connection.configured
    )
  )
}

function validateSharedModelConnections(value: unknown): SharedModelConnectionsSnapshot {
  const snapshot = value as SharedModelConnectionsSnapshot
  if (snapshot?.schemaVersion !== 1 || !Number.isInteger(snapshot.revision) || !Array.isArray(snapshot.providers)) {
    throw new Error('Invalid shared model connection response')
  }
  return snapshot
}

function parseSharedModelConnections(body: string): SharedModelConnectionsSnapshot {
  const value = JSON.parse(body) as unknown
  return validateSharedModelConnections(value)
}

function parseSharedModelConnectionEvent(body: string): SharedModelConnectionsSnapshot {
  const value = JSON.parse(body) as { snapshot?: unknown }
  return validateSharedModelConnections(value?.snapshot)
}

function SharedDefaultModelPicker({
  snapshot,
  error,
  zh,
  onSelect
}: {
  snapshot: SharedModelConnectionsSnapshot | null
  error: string
  zh: boolean
  onSelect: (connection: SharedModelConnection, model: string) => void
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState('')
  const [query, setQuery] = useState('')
  const providers = useMemo(() => snapshot?.providers ?? [], [snapshot?.providers])
  const defaultProvider = providers.find((connection) =>
    connection.id === snapshot?.defaultProviderId
  )
  const activeProvider = providers.find((connection) => connection.id === activeProviderId) ??
    defaultProvider ??
    providers.find((connection) => connection.configured && connection.models.length > 0) ??
    providers[0]
  const normalizedQuery = query.trim().toLowerCase()
  const visibleModels = (activeProvider?.models ?? []).filter((model) =>
    !normalizedQuery || model.toLowerCase().includes(normalizedQuery)
  )
  const selectedLabel = defaultProvider && snapshot?.defaultModel
    ? `${defaultProvider.name} · ${snapshot.defaultModel}`
    : zh
      ? '请选择默认模型'
      : 'Choose a default model'

  useEffect(() => {
    if (!open) return
    setActiveProviderId((current) =>
      providers.some((connection) => connection.id === current)
        ? current
        : defaultProvider?.id ??
          providers.find((connection) => connection.configured && connection.models.length > 0)?.id ??
          providers[0]?.id ??
          ''
    )
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0)
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [defaultProvider?.id, open, providers])

  return (
    <section className="ds-provider-default-model grid gap-3 border-t border-ds-border-muted pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-ds-ink">
            {zh ? '默认模型' : 'Default model'}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-ds-faint">
            {zh
              ? '新建 GUI 和 TUI 会话将自动使用这个供应商与模型。'
              : 'New GUI and TUI sessions will automatically use this provider and model.'}
          </p>
        </div>
        <StatusPill tone={error ? 'warning' : snapshot ? 'success' : 'muted'}>
          {error
            ? (zh ? '等待运行时' : 'Waiting for runtime')
            : snapshot
              ? (zh ? '自动生效' : 'Auto apply')
              : (zh ? '正在连接' : 'Connecting')}
        </StatusPill>
      </div>

      <div ref={rootRef} className="relative max-w-[820px]">
        <label className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {zh ? '默认模型' : 'Default model'}
        </label>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={!snapshot || providers.length === 0}
          onClick={() => {
            setQuery('')
            setOpen((current) => !current)
          }}
          className={`flex h-11 w-full items-center justify-between gap-3 rounded-xl border bg-ds-card px-3.5 text-left text-[13px] shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${
            open
              ? 'border-accent/65 ring-2 ring-accent/15'
              : 'border-ds-border hover:border-accent/40 hover:bg-ds-hover'
          }`}
        >
          <span className={`min-w-0 truncate font-medium ${
            defaultProvider && snapshot?.defaultModel ? 'text-ds-ink' : 'text-ds-faint'
          }`}>
            {selectedLabel}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={1.9}
          />
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label={zh ? '选择默认模型' : 'Choose default model'}
            className="absolute left-0 top-full z-40 mt-2 grid w-full min-w-0 grid-cols-1 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl shadow-black/10 sm:grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.2fr)] dark:shadow-black/35"
          >
            <div className="min-w-0 border-b border-ds-border-muted p-2 sm:border-b-0 sm:border-r">
              <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-ds-faint">
                {zh ? '供应商' : 'Provider'}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {providers.map((connection) => {
                  const active = connection.id === activeProvider?.id
                  const available = connection.configured && connection.models.length > 0
                  return (
                    <button
                      key={connection.id}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setActiveProviderId(connection.id)
                        setQuery('')
                        window.setTimeout(() => searchRef.current?.focus(), 0)
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition ${
                        active
                          ? 'bg-accent/10 font-semibold text-accent'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span className={`min-w-0 truncate ${available ? '' : 'opacity-55'}`}>
                        {connection.name}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-65" strokeWidth={1.9} />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-w-0 p-2">
              <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-ds-faint">
                {zh ? '模型' : 'Model'}
              </div>
              <label className="relative mb-1.5 block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                  strokeWidth={1.9}
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={zh ? '筛选模型' : 'Filter models'}
                  aria-label={zh ? '筛选模型' : 'Filter models'}
                  className="h-9 w-full rounded-lg border border-ds-border bg-ds-main/25 pl-9 pr-3 text-[12px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
                />
              </label>
              <div className="max-h-64 overflow-y-auto">
                {!activeProvider?.configured ? (
                  <p className="px-2.5 py-6 text-center text-[12px] text-ds-faint">
                    {zh ? '此供应商尚未连接' : 'This provider is not connected'}
                  </p>
                ) : visibleModels.length === 0 ? (
                  <p className="px-2.5 py-6 text-center text-[12px] text-ds-faint">
                    {zh ? '没有匹配的模型' : 'No matching models'}
                  </p>
                ) : visibleModels.map((model) => {
                  const selected = activeProvider.id === snapshot?.defaultProviderId &&
                    model === snapshot.defaultModel
                  const vision = modelSupportsImageInput(activeProvider.modelCapabilities?.[model])
                  return (
                    <button
                      key={model}
                      type="button"
                      onClick={() => {
                        onSelect(activeProvider, model)
                        setOpen(false)
                        triggerRef.current?.focus()
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition ${
                        selected
                          ? 'bg-accent/10 font-semibold text-accent'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{model}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
                        vision
                          ? 'border-emerald-300/80 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/35 dark:text-emerald-300'
                          : 'border-ds-border bg-ds-main/35 text-ds-faint'
                      }`}>
                        {vision ? (zh ? '识图' : 'Vision') : (zh ? '文本' : 'Text')}
                      </span>
                      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} /> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="text-[11.5px] text-amber-600 dark:text-amber-400">{error}</p>
      ) : null}
    </section>
  )
}

class SharedModelConnectionConflictError extends Error {
  constructor(readonly snapshot: SharedModelConnectionsSnapshot) {
    super('The shared model configuration changed in another client.')
    this.name = 'SharedModelConnectionConflictError'
  }
}

async function requestSharedModelConnections(
  path: string,
  method = 'GET',
  body?: unknown
): Promise<SharedModelConnectionsSnapshot> {
  const result = await window.kunGui.runtimeRequest(
    path,
    method,
    body === undefined ? undefined : JSON.stringify(body)
  )
  if (!result.ok) {
    if (result.status === 409) {
      try {
        const conflict = JSON.parse(result.body) as { snapshot?: unknown }
        throw new SharedModelConnectionConflictError(
          validateSharedModelConnections(conflict.snapshot)
        )
      } catch (error) {
        if (error instanceof SharedModelConnectionConflictError) throw error
      }
    }
    let message = ''
    try {
      const value = JSON.parse(result.body) as { message?: unknown }
      if (typeof value.message === 'string') message = value.message.trim()
    } catch {
      // Keep the HTTP fallback below.
    }
    throw new Error(message || `Shared model connection request failed (HTTP ${result.status})`)
  }
  return parseSharedModelConnections(result.body)
}

export async function deleteSharedModelConnection(
  providerId: string
): Promise<SharedModelConnectionsSnapshot> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!snapshot.providers.some((connection) => connection.id === providerId)) return snapshot
    try {
      const deleted = await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(providerId)}?expected_revision=${snapshot.revision}`,
        'DELETE'
      )
      if (deleted.providers.some((connection) => connection.id === providerId)) {
        throw new Error(`Shared model connection ${providerId} was not deleted`)
      }
      return deleted
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError)) throw error
      snapshot = error.snapshot
      if (!snapshot.providers.some((connection) => connection.id === providerId)) return snapshot
      if (attempt === 1) throw error
    }
  }
  return snapshot
}

export async function selectSharedModelConnection(
  providerId: string,
  model: string,
  isProviderTombstoned: (providerId: string) => boolean = () => false
): Promise<SharedModelConnectionsSnapshot> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isProviderTombstoned(providerId)) {
      throw new Error(`Shared model connection ${providerId} is pending deletion`)
    }
    const connection = snapshot.providers.find((entry) => entry.id === providerId)
    if (!connection) {
      throw new Error(`Shared model connection ${providerId} is no longer available`)
    }
    if (!connection.configured) {
      throw new Error(`Shared model connection ${providerId} is not configured`)
    }
    if (!connection.models.includes(model)) {
      throw new Error(`Model ${model} is no longer available for ${providerId}`)
    }
    try {
      return await requestSharedModelConnections('/v1/model-connections/select', 'POST', {
        expectedRevision: snapshot.revision,
        providerId: connection.id,
        accountId: connection.accountId,
        model
      })
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return snapshot
}

export function reconcilePendingSharedProviderDeletions(
  snapshot: SharedModelConnectionsSnapshot,
  pending: ReadonlyMap<string, number | null>
): Map<string, number | null> {
  const next = new Map(pending)
  for (const [providerId, deletedAtRevision] of next) {
    if (deletedAtRevision !== null && snapshot.revision > deletedAtRevision) {
      next.delete(providerId)
    }
  }
  return next
}

export type PendingSharedProviderName = {
  localName: string
  canonicalName: string
  committedRevision: number | null
}

export function reconcilePendingSharedProviderNames(
  snapshot: SharedModelConnectionsSnapshot,
  pending: ReadonlyMap<string, PendingSharedProviderName>
): Map<string, PendingSharedProviderName> {
  const next = new Map(pending)
  for (const [providerId, rename] of next) {
    const connection = snapshot.providers.find((item) => item.id === providerId)
    if (!connection) {
      next.delete(providerId)
      continue
    }
    const canonicalNameObserved = connection.name === rename.canonicalName
    const committedRevisionPassed =
      rename.committedRevision !== null && snapshot.revision > rename.committedRevision
    if (canonicalNameObserved || committedRevisionPassed) {
      next.delete(providerId)
    }
  }
  return next
}

export function createSharedModelMutationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export function sharedProvidersEligibleForSync<T extends { id: string }>(
  providers: readonly T[],
  pendingDeletions: Pick<ReadonlySet<string>, 'has'>
): T[] {
  return providers.filter((provider) => !pendingDeletions.has(provider.id))
}

export function clearPendingSharedProviderDeletionForExplicitAdd(
  pendingDeletions: Map<string, number | null>,
  providerId: string
): void {
  pendingDeletions.delete(providerId)
}

function sharedModelProfiles(
  connection: SharedModelConnection,
  existing: ModelProviderProfileV1 | undefined
): Record<string, ModelProviderModelProfileV1> {
  return Object.fromEntries(connection.models.map((model) => {
    const previous = existing?.modelProfiles[model] ??
      existing?.modelProfiles[model.trim().toLowerCase()]
    const capability = connection.modelCapabilities?.[model] ??
      connection.modelCapabilities?.[model.trim().toLowerCase()]
    return [model, {
      ...(previous?.aliases ? { aliases: [...previous.aliases] } : {}),
      inputModalities: capability?.inputModalities ?? previous?.inputModalities ?? ['text'],
      outputModalities: capability?.outputModalities ?? previous?.outputModalities ?? ['text'],
      supportsToolCalling: capability?.supportsToolCalling ?? previous?.supportsToolCalling ?? true,
      messageParts: capability?.messageParts ?? previous?.messageParts ?? ['text'],
      ...(capability?.contextWindowTokens ?? previous?.contextWindowTokens
        ? { contextWindowTokens: capability?.contextWindowTokens ?? previous?.contextWindowTokens }
        : {}),
      ...(capability?.maxOutputTokens ?? previous?.maxOutputTokens
        ? { maxOutputTokens: capability?.maxOutputTokens ?? previous?.maxOutputTokens }
        : {}),
      ...(capability?.reasoning ?? previous?.reasoning
        ? { reasoning: capability?.reasoning ?? previous?.reasoning }
        : {}),
      ...(capability?.endpointFormat ?? previous?.endpointFormat
        ? { endpointFormat: capability?.endpointFormat ?? previous?.endpointFormat }
        : {}),
      ...(capability?.responsesMode ?? previous?.responsesMode
        ? { responsesMode: capability?.responsesMode ?? previous?.responsesMode }
        : {})
    }]
  }))
}

export function projectSharedModelConnections(
  current: ModelProviderSettingsV1,
  snapshot: SharedModelConnectionsSnapshot,
  pendingDeletions: Pick<ReadonlySet<string>, 'has'> = new Set(),
  pendingNames: Pick<ReadonlyMap<string, PendingSharedProviderName>, 'get'> = new Map()
): {
  provider: Pick<ModelProviderSettingsV1, 'providers' | 'proxy' | 'routePools' | 'localGateway'>
  kun: Pick<KunRuntimeSettingsV1, 'providerId' | 'model'>
} {
  const existingById = new Map(current.providers.map((item) => [item.id, item]))
  const visibleConnections = snapshot.providers.filter((connection) => !pendingDeletions.has(connection.id))
  const projectedProviders = visibleConnections.map((connection): ModelProviderProfileV1 => {
    const existing = existingById.get(connection.id)
    return {
      ...(existing ?? {
        id: connection.id,
        name: connection.name,
        apiKey: '',
        baseUrl: connection.baseUrl ?? '',
        endpointFormat: connection.endpointFormat,
        retry: defaultModelRequestRetrySettings(),
        models: [],
        modelProfiles: {}
      }),
      id: connection.id,
      name: pendingNames.get(connection.id)?.localName ?? connection.name,
      // Preserve the ephemeral compatibility value already loaded from the
      // protected settings binding. Replacing it with an empty string makes
      // the settings save path interpret a registry projection as an explicit
      // disconnect and forget every legacy binding.
      apiKey: existing?.apiKey ?? '',
      baseUrl: connection.baseUrl ?? '',
      endpointFormat: connection.endpointFormat,
      kind: connection.kind,
      models: [...connection.models],
      modelProfiles: sharedModelProfiles(connection, existing)
    }
  })
  // AppSettings keeps a normalized DeepSeek editor as its legacy fallback.
  // When the canonical registry intentionally has no DeepSeek profile, retain
  // that local placeholder without treating it as a connected profile.
  const compatibilityDefault = !visibleConnections.some((entry) => entry.id === DEFAULT_MODEL_PROVIDER_ID)
    ? existingById.get(DEFAULT_MODEL_PROVIDER_ID)
    : undefined
  const providers = compatibilityDefault
    ? [compatibilityDefault, ...projectedProviders]
    : projectedProviders
  return {
    provider: {
      providers,
      proxy: snapshot.proxy ?? current.proxy,
      routePools: snapshot.routePools ?? current.routePools,
      localGateway: {
        ...current.localGateway,
        enabled: snapshot.localModelGateway?.enabled ?? current.localGateway.enabled
      }
    },
    kun: {
      providerId: snapshot.defaultProviderId && !pendingDeletions.has(snapshot.defaultProviderId)
        ? snapshot.defaultProviderId
        : '',
      model: snapshot.defaultProviderId && !pendingDeletions.has(snapshot.defaultProviderId)
        ? snapshot.defaultModel ?? ''
        : ''
    }
  }
}

function sharedSettingsFingerprint(input: {
  providers: readonly ModelProviderProfileV1[]
  providerId: string
  model: string
  proxy: ModelProviderSettingsV1['proxy']
  routePools: ModelProviderSettingsV1['routePools']
  localGateway: ModelProviderSettingsV1['localGateway']
}): string {
  return JSON.stringify({
    providers: input.providers.map((item) => ({
      id: item.id,
      name: item.name,
      apiKey: item.apiKey,
      baseUrl: item.baseUrl,
      endpointFormat: item.endpointFormat,
      kind: item.kind,
      models: item.models,
      modelProfiles: item.modelProfiles
    })),
    providerId: input.providerId,
    model: input.model,
    proxy: input.proxy,
    routePools: input.routePools,
    localGateway: input.localGateway
  })
}

function sharedCapabilitiesFromProvider(
  provider: ModelProviderProfileV1
): SharedModelConnection['modelCapabilities'] {
  return Object.fromEntries(provider.models.flatMap((model) => {
    const profile = provider.modelProfiles[model] ??
      provider.modelProfiles[model.trim().toLowerCase()]
    return profile ? [[model, { id: model, ...profile }]] : []
  }))
}
import { classifyProviderModelIds, providerModelListEntries } from './provider-model-editor'
import { ProviderModelsManager } from './settings-section-provider-models'
import { ModelRoutesSettings } from './settings-section-model-routes'
import { ClaudeSubscriptionSection } from './claude-subscription-section'
import {
  ProviderModelImportDialog,
  type ProviderModelImportResult
} from './provider-model-import-dialog'
import {
  enrichCursorProviderModelProfiles,
  enrichProviderModelProfiles,
  mergeProviderModelIdsCaseInsensitive as mergeProviderModelIds
} from './provider-model-import'

const MODEL_ENDPOINT_FORMAT_LABEL_KEYS: Record<ModelEndpointFormat, string> = {
  chat_completions: 'modelEndpointChatCompletions',
  responses: 'modelEndpointResponses',
  messages: 'modelEndpointMessages',
  custom_endpoint: 'modelEndpointCustomEndpoint'
}

const IMAGE_GENERATION_PROTOCOL_LABEL_KEYS: Record<ImageGenerationProtocol, string> = {
  'openai-images': 'imageGenProtocolOpenAi',
  'minimax-image': 'imageGenProtocolMiniMax',
  'codex-responses-image': 'imageGenProtocolCodex',
  'grok-imagine-image': 'imageGenProtocolGrok',
  'volcengine-ark-image': 'imageGenProtocolVolcengineArk'
}

const SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS: Partial<Record<SpeechToTextProtocol, string>> = {
  'openai-transcriptions': 'speechProtocolOpenAi',
  'mimo-asr': 'speechProtocolMimoAsr',
  'xai-stt': 'speechProtocolXaiStt',
  'gemini-audio': 'speechProtocolGeminiAudio',
  'gemini-cli-audio': 'speechProtocolGeminiCliAudio'
}

const TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS: Record<TextToSpeechProtocol, string> = {
  'openai-speech': 'textToSpeechProtocolOpenAi',
  'minimax-t2a': 'textToSpeechProtocolMiniMax',
  'mimo-tts': 'textToSpeechProtocolMimo'
}

const MUSIC_GENERATION_PROTOCOL_LABEL_KEYS: Record<MusicGenerationProtocol, string> = {
  'minimax-music': 'musicGenerationProtocolMiniMax'
}

const VIDEO_GENERATION_PROTOCOL_LABEL_KEYS: Record<VideoGenerationProtocol, string> = {
  'minimax-video': 'videoGenerationProtocolMiniMax',
  'grok-imagine-video': 'videoGenerationProtocolGrok',
  'volcengine-ark-video': 'videoGenerationProtocolVolcengineArk'
}

type ProviderTaskTab = 'connection' | 'models' | 'capabilities' | 'advanced'
type ProviderWorkspaceMode = 'providers' | 'routes'
type ProviderCapability = 'image' | 'speech' | 'tts' | 'music' | 'video'
type SubscriptionRegionFilter = 'all' | ModelProviderSubscriptionRegion

export function antigravityProviderCatalogPatch(
  catalog: AntigravitySubscriptionModelCatalog,
  existingProfiles: Readonly<Record<string, ModelProviderModelProfileV1>> = {}
): Pick<ModelProviderProfileV1, 'models' | 'modelProfiles'> {
  const models = catalog.models.map((model) => model.id)
  const modelProfiles = Object.fromEntries(catalog.models.map((model) => {
    const existing = existingProfiles[model.id]
    const supportsImageInput = /^(?:gemini|claude)-/i.test(model.id)
    return [
      model.id,
      {
        ...existing,
        inputModalities: existing?.inputModalities ?? (
          supportsImageInput ? ['text', 'image'] : ['text']
        ),
        outputModalities: existing?.outputModalities ?? ['text'],
        supportsToolCalling: existing?.supportsToolCalling ?? true,
        messageParts: existing?.messageParts ?? (
          supportsImageInput ? ['text', 'image_url'] : ['text']
        ),
        reasoning: {
          supportedEfforts: [...model.supportedEfforts],
          defaultEffort: model.defaultEffort,
          requestProtocol: 'none'
        }
      } satisfies ModelProviderModelProfileV1
    ]
  }))
  return { models, modelProfiles }
}

const PROVIDER_TASK_TABS: Array<{ id: ProviderTaskTab; labelKey: string }> = [
  { id: 'connection', labelKey: 'modelProviderTabConnection' },
  { id: 'models', labelKey: 'modelProviderTabModels' },
  { id: 'capabilities', labelKey: 'modelProviderTabCapabilities' },
  { id: 'advanced', labelKey: 'modelProviderTabAdvanced' }
]

const SUBSCRIPTION_REGION_TABS: Array<{
  id: SubscriptionRegionFilter
  labelKey: string
}> = [
  { id: 'all', labelKey: 'modelProviderSubscriptionRegionAll' },
  { id: 'china', labelKey: 'modelProviderSubscriptionRegionChina' },
  { id: 'united-states', labelKey: 'modelProviderSubscriptionRegionUnitedStates' }
]

export function modelProvidersSettingsPatch(input: {
  provider: ModelProviderSettingsV1
  providers: ModelProviderProfileV1[]
  kun?: KunRuntimeSettingsPatchV1
  currentKun?: Partial<KunRuntimeSettingsV1>
}): AppSettingsPatch {
  const defaultProvider = input.providers.find((item) => item.id === DEFAULT_MODEL_PROVIDER_ID)
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationKunPatch({
    providers: input.providers,
    currentKun: input.currentKun,
    kunPatch: input.kun
  })
  const baseKunPatch = input.kun?.providerId?.trim()
    ? { ...input.kun, apiKey: '', baseUrl: '' }
    : input.kun ?? {}
  const kunPatch = {
    ...baseKunPatch,
    ...(miniMaxMediaDefaults ?? {})
  }
  return {
    provider: {
      apiKey: defaultProvider?.apiKey ?? input.provider.apiKey,
      baseUrl: defaultProvider?.baseUrl ?? input.provider.baseUrl,
      proxy: input.provider.proxy,
      providers: input.providers,
      routePools: input.provider.routePools,
      localGateway: input.provider.localGateway
    },
    ...(Object.keys(kunPatch).length > 0 ? { agents: { kun: kunPatch } } : {})
  }
}

function tokenPlanPresetForProfile(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): ModelProviderPreset | null {
  const source = resolveModelProviderPresetSource(provider)
  return source?.mode === 'token-plan' ? source.preset : null
}

// 「套餐订阅」组 = Token Plan 套餐档(<id>-token-plan)或本身就是订阅制的预设(category==='subscription');
// 其余(默认 / 按量预设 / 自定义)归入「按量 API」组,便于一眼分辨两类计费方式。
function isAgentSdkProvider(provider: ModelProviderProfileV1): boolean {
  return provider.kind === 'agent-sdk'
}

function isCursorSubscriptionProvider(provider: ModelProviderProfileV1): boolean {
  return provider.kind === 'cursor-sdk'
}

const CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL = 'cursor-subscription:discover'

function cursorSubscriptionDiscoveryErrorMessage(
  error: unknown,
  bridgeUnavailableMessage: string
): string {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes(`No handler registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
    || message.includes(`No bridge registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
    || /cursorSubscriptionDiscover.*not a function/i.test(message)
  ) {
    return bridgeUnavailableMessage
  }
  return message
}

function isDelegatedEndpointProvider(provider: ModelProviderProfileV1): boolean {
  return isAgentSdkProvider(provider)
    || isGeminiSubscriptionProvider(provider)
    || isGeminiCliApiSubscriptionProvider(provider)
    || isCursorSubscriptionProvider(provider)
}

function isSubscriptionProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): boolean {
  const source = resolveModelProviderPresetSource(provider)
  return source?.mode === 'token-plan' || source?.preset.category === 'subscription'
}

function addedModelCount(current: readonly string[], next: readonly string[]): number {
  const currentIds = new Set(current.map((model) => model.trim().toLowerCase()).filter(Boolean))
  return next.filter((model) => {
    const id = model.trim().toLowerCase()
    return id && !currentIds.has(id)
  }).length
}

function providerModelCount(provider: ModelProviderProfileV1): number {
  return providerModelListEntries(provider).length
}

function defaultImageCapability(baseUrl: string): ModelProviderImageCapabilityV1 {
  return {
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultSpeechCapability(baseUrl: string): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultTextToSpeechCapability(baseUrl: string): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultMusicCapability(baseUrl: string): ModelProviderMusicCapabilityV1 {
  return {
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultVideoCapability(baseUrl: string): ModelProviderVideoCapabilityV1 {
  return {
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function profileForModel(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  const trimmed = model.trim()
  if (!trimmed) return undefined
  return provider.modelProfiles[trimmed.toLowerCase()] ?? provider.modelProfiles[trimmed]
}

function cursorProviderNeedsMetadataRepair(provider: ModelProviderProfileV1): boolean {
  if (!isCursorSubscriptionProvider(provider)) return false
  return provider.models.some((model) => {
    if (model.trim().toLowerCase() === 'auto') return false
    const profile = profileForModel(provider, model)
    return !profile || (
      profile.contextWindowTokens === undefined
      && profile.maxOutputTokens === undefined
    ) || !profile.reasoning
  })
}

function presetProfileForProvider(provider: ModelProviderProfileV1): ModelProviderProfileV1 | null {
  const source = resolveModelProviderPresetSource(provider)
  if (!source) return null
  return source.mode === 'token-plan'
    ? modelProviderTokenPlanProfile(source.preset, '', provider.baseUrl)
    : modelProviderPresetProfile(source.preset)
}

function presetImageCapability(provider: ModelProviderProfileV1): ModelProviderImageCapabilityV1 | null {
  return presetProfileForProvider(provider)?.image ?? null
}

function presetSpeechCapability(provider: ModelProviderProfileV1): ModelProviderSpeechCapabilityV1 | null {
  return presetProfileForProvider(provider)?.speech ?? null
}

function presetTextToSpeechCapability(provider: ModelProviderProfileV1): ModelProviderTextToSpeechCapabilityV1 | null {
  return presetProfileForProvider(provider)?.textToSpeech ?? null
}

function presetMusicCapability(provider: ModelProviderProfileV1): ModelProviderMusicCapabilityV1 | null {
  return presetProfileForProvider(provider)?.music ?? null
}

function presetVideoCapability(provider: ModelProviderProfileV1): ModelProviderVideoCapabilityV1 | null {
  return presetProfileForProvider(provider)?.video ?? null
}

function isAcceptableHttpUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}

function providerConnectionFingerprint(provider: ModelProviderProfileV1): string {
  return [provider.baseUrl, provider.apiKey, provider.endpointFormat].join('\0')
}

type ProbeState = {
  fingerprint: string
  mode: 'test' | 'fetch'
  status: 'busy' | 'ok' | 'error'
  latencyMs?: number
  total?: number
  message?: string
}

function isCodexProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'codex'
}

function isGrokSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'grok-subscription'
}

function isGeminiSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'gemini-subscription'
}

function isGeminiCliApiSubscriptionProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'gemini-cli-subscription'
}

function isOAuthSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return isCodexProvider(provider)
    || isGrokSubscriptionProvider(provider)
    || isGeminiSubscriptionProvider(provider)
    || isGeminiCliApiSubscriptionProvider(provider)
}

function parseCodexEmail(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind === 'codex-oauth' && typeof parsed.email === 'string') return parsed.email
    if (parsed.kind === 'codex-oauth') return parsed.accountId as string
  } catch { /* ignore */ }
  return undefined
}

function parseGrokIdentity(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind !== 'grok-oauth') return undefined
    if (typeof parsed.email === 'string' && parsed.email) return parsed.email
    if (typeof parsed.userId === 'string' && parsed.userId) return parsed.userId
  } catch { /* ignore */ }
  return undefined
}

type CodexLoginPhase = 'idle' | 'browser' | 'device-starting' | 'polling' | 'error'

function CodexLoginSection({
  provider,
  onCredentialChange,
  t
}: {
  provider: ModelProviderProfileV1
  onCredentialChange: (apiKey: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [phase, setPhase] = useState<CodexLoginPhase>('idle')
  const [userCode, setUserCode] = useState('')
  const [verifyUrl, setVerifyUrl] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loginRunRef = useRef(0)
  const codexEmail = parseCodexEmail(provider.apiKey)
  const connected = Boolean(codexEmail)

  const clearPoll = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const beginLoginRun = (): number => {
    clearPoll()
    loginRunRef.current += 1
    return loginRunRef.current
  }

  const isCurrentLoginRun = (runId: number): boolean => loginRunRef.current === runId

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      loginRunRef.current += 1
    }
  }, [])

  const startDeviceCodeLogin = async ({
    runId = beginLoginRun(),
    fallbackNotice = null
  }: {
    runId?: number
    fallbackNotice?: InlineNotice | null
  } = {}): Promise<void> => {
    if (typeof window.kunGui?.startCodexAuth !== 'function') {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError('ChatGPT 订阅登录不可用，请重启应用')
      setNotice(null)
      return
    }
    setPhase('device-starting')
    setError('')
    setNotice(fallbackNotice)
    try {
      const result = await window.kunGui.startCodexAuth()
      if (!isCurrentLoginRun(runId)) return
      if (!result.ok) {
        setPhase('error')
        setError(result.message)
        setNotice(null)
        return
      }
      setUserCode(result.userCode)
      setVerifyUrl(result.url)
      setPhase('polling')
      const deviceCode = result.deviceCode
      const uc = result.userCode
      const interval = Math.max(result.interval, 2) * 1000
      clearPoll()
      pollRef.current = setInterval(async () => {
        if (!isCurrentLoginRun(runId)) {
          clearPoll()
          return
        }
        if (typeof window.kunGui?.pollCodexAuth !== 'function') return
        try {
          const poll = await window.kunGui.pollCodexAuth(deviceCode, uc)
          if (!isCurrentLoginRun(runId)) return
          if (poll.done) {
            clearPoll()
            setNotice(null)
            onCredentialChange(JSON.stringify(poll.credentials))
            setPhase('idle')
          } else if (poll.error) {
            clearPoll()
            setPhase('error')
            setError(poll.error)
            setNotice(null)
          }
        } catch (pollError) {
          if (!isCurrentLoginRun(runId)) return
          clearPoll()
          setPhase('error')
          setError(pollError instanceof Error ? pollError.message : String(pollError))
          setNotice(null)
        }
      }, interval)
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
      setNotice(null)
    }
  }

  const startBrowserLogin = async (): Promise<void> => {
    const runId = beginLoginRun()
    if (typeof window.kunGui?.startCodexBrowserAuth !== 'function') {
      setPhase('error')
      setError('ChatGPT 订阅浏览器登录不可用，请重启应用')
      setNotice(null)
      return
    }
    setPhase('browser')
    setError('')
    setNotice(null)
    try {
      const result = await window.kunGui.startCodexBrowserAuth()
      if (!isCurrentLoginRun(runId)) return
      if (result.ok) {
        setNotice(null)
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else if (result.code === 'port_in_use') {
        await startDeviceCodeLogin({
          runId,
          fallbackNotice: {
            tone: 'info',
            message: t('codexLoginPortBusyFallback')
          }
        })
      } else {
        setPhase('error')
        setError(result.message)
      }
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
      setNotice(null)
    }
  }

  const cancelLogin = (): void => {
    loginRunRef.current += 1
    clearPoll()
    setPhase('idle')
    setError('')
    setNotice(null)
  }

  const disconnect = (): void => {
    loginRunRef.current += 1
    clearPoll()
    onCredentialChange('')
    setPhase('idle')
    setUserCode('')
    setVerifyUrl('')
    setNotice(null)
  }

  const openVerifyUrl = (): void => {
    if (!verifyUrl) return
    if (typeof window.kunGui?.openExternal === 'function') {
      void window.kunGui.openExternal(verifyUrl).catch(() => {
        window.open(verifyUrl, '_blank', 'noopener,noreferrer')
      })
      return
    }
    window.open(verifyUrl, '_blank', 'noopener,noreferrer')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{codexEmail}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('codexDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('codexBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  if (phase === 'device-starting') {
    return (
      <div className="grid gap-2">
        {notice ? <InlineNoticeView notice={notice} /> : null}
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexPreparingDeviceLogin')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  if (phase === 'polling') {
    return (
      <div className="grid gap-2">
        {notice ? <InlineNoticeView notice={notice} /> : null}
        <p className="text-[13px] text-ds-muted">{t('codexEnterCode')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-ds-hover px-3 py-1.5 text-[16px] font-mono font-bold tracking-widest text-ds-ink">
            {userCode}
          </code>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openVerifyUrl}
            disabled={!verifyUrl}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('codexOpenBrowser')}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
        onClick={startBrowserLogin}
      >
        <LogIn className="h-4 w-4" strokeWidth={1.9} />
        {t('codexLoginButton')}
      </button>
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover"
        onClick={() => void startDeviceCodeLogin()}
      >
        <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('codexLoginDeviceCodeFallback')}
      </button>
      {phase === 'error' && error ? (
        <InlineNoticeView notice={{ tone: 'error', message: error }} />
      ) : null}
    </div>
  )
}

type GrokLoginPhase = 'idle' | 'browser' | 'error'

function GrokLoginSection({
  provider,
  onCredentialChange,
  t
}: {
  provider: ModelProviderProfileV1
  onCredentialChange: (apiKey: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [phase, setPhase] = useState<GrokLoginPhase>('idle')
  const [error, setError] = useState('')
  const [pasteCode, setPasteCode] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const loginRunRef = useRef(0)
  const identity = parseGrokIdentity(provider.apiKey)
  const connected = Boolean(identity)

  const beginLoginRun = (): number => {
    loginRunRef.current += 1
    return loginRunRef.current
  }

  const isCurrentLoginRun = (runId: number): boolean => loginRunRef.current === runId

  useEffect(() => {
    return () => {
      loginRunRef.current += 1
      void window.kunGui?.cancelGrokBrowserAuth?.()
    }
  }, [])

  const startBrowserLogin = async (): Promise<void> => {
    const runId = beginLoginRun()
    if (typeof window.kunGui?.startGrokBrowserAuth !== 'function') {
      setPhase('error')
      setError('Grok 订阅浏览器登录不可用，请重启应用')
      return
    }
    setPhase('browser')
    setError('')
    setPasteCode('')
    setPasteBusy(false)
    try {
      // Blocks until loopback callback OR paste completion (Path A + B race).
      const result = await window.kunGui.startGrokBrowserAuth()
      if (!isCurrentLoginRun(runId)) return
      if (result.ok) {
        setPasteCode('')
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else if (result.message === '已取消登录') {
        setPhase('idle')
        setError('')
      } else {
        setPhase('error')
        setError(result.message)
      }
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPasteBusy(false)
    }
  }

  const submitPastedCode = async (): Promise<void> => {
    const code = pasteCode.trim()
    if (!code || pasteBusy) return
    if (typeof window.kunGui?.submitGrokBrowserAuthCode !== 'function') {
      setError('Grok 粘贴登录不可用，请重启应用')
      return
    }
    setPasteBusy(true)
    setError('')
    try {
      const result = await window.kunGui.submitGrokBrowserAuthCode(code)
      // On success, startGrokBrowserAuth's promise also resolves and the browser
      // phase handler will store credentials. On failure keep the paste form open.
      if (!result.ok) {
        setError(result.message)
        setPasteBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPasteBusy(false)
    }
  }

  const cancelLogin = (): void => {
    loginRunRef.current += 1
    void window.kunGui?.cancelGrokBrowserAuth?.()
    setPhase('idle')
    setError('')
    setPasteCode('')
    setPasteBusy(false)
  }

  const disconnect = (): void => {
    loginRunRef.current += 1
    void window.kunGui?.cancelGrokBrowserAuth?.()
    onCredentialChange('')
    setPhase('idle')
    setPasteCode('')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{identity}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('grokDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('grokBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('grokWaitingAuth')}
        </div>
        <div className="grid gap-1.5 rounded-xl border border-ds-border bg-ds-card p-3">
          <p className="text-[12px] leading-5 text-ds-muted">{t('grokPasteCodeHint')}</p>
          <textarea
            className="min-h-[72px] w-full resize-y rounded-lg border border-ds-border bg-ds-main px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
            value={pasteCode}
            spellCheck={false}
            placeholder={t('grokPasteCodePlaceholder')}
            onChange={(e) => setPasteCode(e.target.value)}
            disabled={pasteBusy}
          />
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void submitPastedCode()}
            disabled={pasteBusy || !pasteCode.trim()}
          >
            {pasteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('grokPasteCodeSubmit')}
          </button>
        </div>
        {error ? <InlineNoticeView notice={{ tone: 'error', message: error }} /> : null}
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('grokCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
        onClick={startBrowserLogin}
      >
        <LogIn className="h-4 w-4" strokeWidth={1.9} />
        {t('grokLoginButton')}
      </button>
      {phase === 'error' && error ? (
        <InlineNoticeView notice={{ tone: 'error', message: error }} />
      ) : null}
    </div>
  )
}

type GeminiCliState = 'checking' | 'missing' | 'downloading' | 'ready' | 'syncing'

function GeminiSubscriptionSection({
  onModelsChange,
  t
}: {
  onModelsChange: (catalog: AntigravitySubscriptionModelCatalog) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [state, setState] = useState<GeminiCliState>('checking')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [notice, setNotice] = useState<InlineNotice | null>(null)

  const applyDownload = useCallback((
    download: { status: string; receivedBytes: number; totalBytes: number; message?: string } | null | undefined
  ): boolean => {
    if (!download) return false
    if (download.status === 'downloading') {
      setState('downloading')
      setProgress({ received: download.receivedBytes, total: download.totalBytes })
      return true
    }
    if (download.status === 'done') {
      setState('ready')
      setProgress(null)
      return true
    }
    if (download.status === 'error') {
      setState('missing')
      setProgress(null)
      setNotice({ tone: 'error', message: download.message ?? t('geminiCliInstallFailed') })
      return true
    }
    return false
  }, [t])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.kunGui.geminiSubscriptionCliStatus()
      if (status.installed) {
        setState('ready')
        setProgress(null)
      } else if (!applyDownload(status.download)) {
        setState('missing')
      }
    } catch (error) {
      setState('missing')
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliInstallFailed')
      })
    }
  }, [applyDownload, t])

  useEffect(() => {
    void refreshStatus()
    return window.kunGui.onGeminiSubscriptionCliProgress((download) => {
      applyDownload(download)
      if (download.status === 'done') void refreshStatus()
    })
  }, [applyDownload, refreshStatus])

  const install = async (): Promise<void> => {
    setNotice(null)
    setState('downloading')
    setProgress({ received: 0, total: 0 })
    try {
      applyDownload(await window.kunGui.geminiSubscriptionCliInstall())
    } catch (error) {
      setState('missing')
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliInstallFailed')
      })
    }
  }

  const syncModels = async (): Promise<void> => {
    setState('syncing')
    setNotice(null)
    try {
      const catalog = await window.kunGui.geminiSubscriptionModels()
      onModelsChange(catalog)
      setNotice({
        tone: 'success',
        message: t('geminiModelsSynced', { count: catalog.models.length })
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiModelsSyncFailed')
      })
    } finally {
      setState('ready')
    }
  }

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0
  const busy = state === 'checking' || state === 'downloading' || state === 'syncing'

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-5 text-ds-muted">
        <p>{t('geminiSubscriptionNote')}</p>
        <p className="text-ds-ink/85">{t('geminiSubscriptionLimitations')}</p>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-ds-ink">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-ds-muted" strokeWidth={1.9} />
        ) : state === 'ready' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.9} />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" strokeWidth={1.9} />
        )}
        <span>{state === 'ready' || state === 'syncing'
          ? t('geminiCliReady')
          : state === 'downloading'
            ? t('geminiCliDownloading')
            : state === 'checking'
              ? t('geminiCliChecking')
              : t('geminiCliMissing')}</span>
      </div>
      {state === 'downloading' ? (
        <div className="grid gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-ds-hover">
            <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-[11px] text-ds-faint">
            {progress?.total ? `${percent}%` : t('geminiCliDownloading')}
          </span>
        </div>
      ) : null}
      {state === 'missing' ? (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
          onClick={() => void install()}
        >
          <Download className="h-4 w-4" strokeWidth={1.9} />
          {t('geminiCliInstall')}
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
          onClick={() => void syncModels()}
          disabled={busy}
        >
          {state === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('geminiSyncModels')}
        </button>
      )}
      {notice ? <InlineNoticeView notice={notice} /> : null}
    </div>
  )
}

function GeminiCliApiSubscriptionSection({
  onModelsChange,
  t
}: {
  onModelsChange: (models: string[]) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [checking, setChecking] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{
    installed: boolean
    authenticated: boolean
    path?: string
    credentialSource?: 'keychain' | 'file'
  } | null>(null)
  const [notice, setNotice] = useState<InlineNotice | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      setStatus(await window.kunGui.geminiCliSubscriptionStatus())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliApiStatusFailed')
      })
    } finally {
      setChecking(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const syncModels = async (): Promise<void> => {
    setSyncing(true)
    setNotice(null)
    try {
      const models = await window.kunGui.geminiCliSubscriptionModels()
      onModelsChange(models)
      setNotice({
        tone: 'success',
        message: t('geminiCliApiModelsSynced', { count: models.length })
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliApiModelsSyncFailed')
      })
    } finally {
      setSyncing(false)
    }
  }

  const ready = status?.authenticated === true
  return (
    <div className="grid gap-3">
      <p className="rounded-lg border border-ds-border bg-ds-main/30 px-3 py-2 text-[12px] leading-5 text-ds-muted">
        {t('geminiCliApiSubscriptionNote')}
      </p>
      <div className="flex items-center gap-2 text-[13px] text-ds-ink">
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin text-ds-muted" strokeWidth={1.9} />
        ) : ready ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.9} />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" strokeWidth={1.9} />
        )}
        <span>
          {checking
            ? t('geminiCliApiChecking')
            : ready
              ? t('geminiCliApiReady')
              : status?.installed
                ? t('geminiCliApiLoginRequired')
                : t('geminiCliApiMissing')}
        </span>
      </div>
      {!checking && !ready ? (
        <p className="text-[12px] leading-5 text-ds-muted">
          {status?.installed
            ? t('geminiCliApiLoginHint')
            : t('geminiCliApiInstallHint')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
          onClick={() => void refresh()}
          disabled={checking}
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {t('geminiCliApiRecheck')}
        </button>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
          onClick={() => void syncModels()}
          disabled={syncing}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('geminiCliApiSyncModels')}
        </button>
      </div>
      {notice ? <InlineNoticeView notice={notice} /> : null}
    </div>
  )
}

const fieldLabelClass = 'grid gap-2 text-[13px] font-semibold text-ds-ink'
const textInputClass =
  'h-11 w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-3.5 text-[14px] font-normal text-ds-ink transition focus:border-accent/55 focus:outline-none focus:ring-2 focus:ring-accent/15'
const providerSelectControlClass =
  'h-11 w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-3.5 text-[14px] font-normal text-ds-ink transition focus:border-accent/55 focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-55'
function retryStatusCodesText(codes: readonly number[] | undefined): string {
  return (codes?.length ? codes : defaultModelRequestRetrySettings().httpStatusCodes).join(',')
}

function providerRetrySettings(provider: ModelProviderProfileV1) {
  return provider.retry ?? defaultModelRequestRetrySettings()
}

function parseRetryStatusCodes(value: string): number[] {
  const codes = new Set<number>()
  for (const part of value.split(/[\s,]+/)) {
    const code = Number(part.trim())
    if (Number.isInteger(code) && code >= 400 && code <= 599) codes.add(code)
  }
  return codes.size > 0
    ? [...codes].sort((a, b) => a - b)
    : defaultModelRequestRetrySettings().httpStatusCodes
}

function DetailSection({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <section className="grid gap-4 border-t border-ds-border-muted pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ds-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function StatusPill({
  tone,
  icon,
  children,
  title
}: {
  tone: 'success' | 'warning' | 'error' | 'muted'
  icon?: ReactNode
  children: ReactNode
  title?: string
}): ReactElement {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
        : tone === 'error'
          ? 'border-red-300/70 bg-red-50 text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-300'
          : 'border-ds-border-muted bg-ds-main/50 text-ds-muted'
  return (
    <span
      title={title}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${toneClass}`}
    >
      {icon}
      {children}
    </span>
  )
}

function CapabilitySection({
  capabilityId,
  icon,
  title,
  description,
  enabled,
  invalid,
  expanded,
  modelCountLabel,
  configureLabel,
  collapseLabel,
  enabledLabel,
  disabledLabel,
  needsConfigurationLabel,
  toggleDisabled = false,
  onToggle,
  onExpandedChange,
  children
}: {
  capabilityId: ProviderCapability
  icon: ReactNode
  title: string
  description: string
  enabled: boolean
  invalid?: boolean
  expanded: boolean
  modelCountLabel?: string
  configureLabel: string
  collapseLabel: string
  enabledLabel: string
  disabledLabel: string
  needsConfigurationLabel: string
  toggleDisabled?: boolean
  onToggle: (enabled: boolean) => void
  onExpandedChange: (expanded: boolean) => void
  children: ReactNode
}): ReactElement {
  return (
    <section className={`rounded-2xl border bg-ds-card transition ${
      enabled ? 'border-ds-border shadow-sm' : 'border-ds-border-muted'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
            enabled ? 'bg-accent/10 text-accent' : 'bg-ds-main text-ds-faint'
          }`}>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-ds-ink">{title}</h3>
              <StatusPill tone={invalid ? 'warning' : enabled ? 'success' : 'muted'}>
                {invalid ? needsConfigurationLabel : enabled ? enabledLabel : disabledLabel}
              </StatusPill>
              {modelCountLabel ? (
                <span className="text-[11.5px] text-ds-faint">{modelCountLabel}</span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ds-faint">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!enabled}
            aria-expanded={enabled && expanded}
            aria-controls={`provider-capability-${capabilityId}`}
            aria-label={`${expanded ? collapseLabel : configureLabel}: ${title}`}
            onClick={() => onExpandedChange(!expanded)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
            {expanded ? collapseLabel : configureLabel}
          </button>
          <Toggle
            checked={enabled}
            onChange={onToggle}
            disabled={toggleDisabled}
            ariaLabel={title}
          />
        </div>
      </div>
      {enabled && expanded ? (
        <div id={`provider-capability-${capabilityId}`} className="border-t border-ds-border-muted px-4 py-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}

function ProviderBadge({
  tone,
  children
}: {
  tone: 'accent' | 'warning'
  children: ReactNode
}): ReactElement {
  const toneClass =
    tone === 'accent'
      ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
      : 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${toneClass}`}>
      {children}
    </span>
  )
}

function ProviderListGroup({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: ReactNode
}): ReactElement {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ds-faint">{label}</span>
        <span className="text-[11px] font-medium text-ds-faint">· {count}</span>
      </div>
      <div className="grid max-h-[360px] gap-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  )
}

function ModelChipsInput({
  values,
  onChange,
  placeholder,
  inputAriaLabel,
  removeLabel
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  inputAriaLabel: string
  removeLabel: (model: string) => string
}): ReactElement {
  const [draft, setDraft] = useState('')

  const commit = (raw: string): void => {
    const ids = raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
    setDraft('')
    if (ids.length === 0) return
    const seen = new Set(values)
    const next = [...values]
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    if (next.length !== values.length) onChange(next)
  }

  const removeAt = (index: number): void => {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2 py-1.5 shadow-sm focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/30">
      {values.map((model, index) => (
        <span
          key={`${model}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-ds-border-muted bg-ds-main/60 py-0.5 pl-2.5 pr-1 font-mono text-[12px] text-ds-ink"
        >
          <span className="truncate">{model}</span>
          <button
            type="button"
            aria-label={removeLabel(model)}
            onClick={() => removeAt(index)}
            className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[150px] flex-1 bg-transparent px-1 py-1 font-mono text-[12.5px] font-normal text-ds-ink placeholder:text-ds-faint focus:outline-none"
        value={draft}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            e.preventDefault()
            removeAt(values.length - 1)
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (/[\s,]/.test(text)) {
            e.preventDefault()
            commit(`${draft} ${text}`)
          }
        }}
      />
    </div>
  )
}

export function ProvidersSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider: providerFromContext,
    kun,
    update,
    showApiKey,
    setShowApiKey,
    selectControlClass,
    saveStatus,
    saveError,
    retrySave
  } = ctx
  const zh = form.locale === 'zh'
  const provider = providerFromContext ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const [sharedConnections, setSharedConnections] = useState<SharedModelConnectionsSnapshot | null>(null)
  const [sharedConnectionsError, setSharedConnectionsError] = useState('')
  const sharedSyncFingerprint = useRef('')
  const sharedProjectionPending = useRef(false)
  const dirtyCredentialProviderIds = useRef(new Set<string>())
  const pendingSharedProviderDeletions = useRef(new Map<string, number | null>())
  const pendingSharedProviderNames = useRef(new Map<string, PendingSharedProviderName>())
  const enqueueSharedMutation = useMemo(() => createSharedModelMutationQueue(), [])
  const sharedProjectionInput = useRef({ provider, kun, update, form })
  sharedProjectionInput.current = { provider, kun, update, form }
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    kun.providerId?.trim() || modelProviders[0]?.id || DEFAULT_MODEL_PROVIDER_ID
  )
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addProviderQuery, setAddProviderQuery] = useState('')
  const [subscriptionRegion, setSubscriptionRegion] = useState<SubscriptionRegionFilter>('all')
  const [providerListQuery, setProviderListQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ProviderTaskTab>('connection')
  const [workspaceMode, setWorkspaceMode] = useState<ProviderWorkspaceMode>('providers')
  const [expandedCapabilities, setExpandedCapabilities] = useState<Set<ProviderCapability>>(new Set())
  const addProviderButtonRef = useRef<HTMLButtonElement>(null)
  const addProviderDialogRef = useRef<HTMLElement>(null)
  const previousProviderSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!addMenuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setAddMenuOpen(false)
        addProviderButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])
  const [probeStates, setProbeStates] = useState<Record<string, ProbeState>>({})
  const [cursorAccounts, setCursorAccounts] = useState<Record<string, {
    fingerprint: string
    label: string
    apiKeyName: string
  }>>({})
  // Pending import dialog: when /v1/models returns hundreds of entries we want
  // the user to choose which ones to keep instead of dropping the whole list
  // into settings and forcing them to delete unwanted models one-by-one (#397).
  const [pendingImport, setPendingImport] = useState<
    | {
        providerId: string
        providerModelIds: string[]
        modelAliases?: Record<string, string[]>
        discoveredModelProfiles?: Record<string, ModelProviderModelProfileV1>
        catalogResult: ModelsDevCatalogResult
        providerError?: string
        authoritative?: boolean
      }
    | null
  >(null)
  const cursorMetadataRepairAttempts = useRef(new Set<string>())
  // 新增供应商先停留在本地草稿,点「添加」才写入设置,避免半配置状态被持久化。
  const [draftProvider, setDraftProvider] = useState<ModelProviderProfileV1 | null>(null)
  const displayProviders = useMemo(
    () => draftProvider ? [...modelProviders, draftProvider] : modelProviders,
    [draftProvider, modelProviders]
  )
  const activeProvider =
    displayProviders.find((item) => item.id === selectedProviderId) ??
    modelProviders[0]
  const sharedConnectionFor = (providerId: string): SharedModelConnection | undefined =>
    sharedConnections?.providers.find((connection) => connection.id === providerId)
  const hasConfiguredCredential = (provider: ModelProviderProfileV1): boolean =>
    Boolean(provider.apiKey.trim() || sharedConnectionFor(provider.id)?.configured)
  useEffect(() => {
    if (displayProviders.some((item) => item.id === selectedProviderId)) return
    setSelectedProviderId(
      sharedConnections?.defaultProviderId &&
      displayProviders.some((item) => item.id === sharedConnections.defaultProviderId)
        ? sharedConnections.defaultProviderId
        : displayProviders[0]?.id ?? DEFAULT_MODEL_PROVIDER_ID
    )
  }, [displayProviders, selectedProviderId, sharedConnections?.defaultProviderId])
  const activeRetry = activeProvider ? providerRetrySettings(activeProvider) : defaultModelRequestRetrySettings()
  const isDraftActive = Boolean(draftProvider && activeProvider?.id === draftProvider.id)
  const canEditActiveProviderId = Boolean(
    activeProvider &&
    activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID &&
    !sharedConnections?.providers.some((connection) => connection.id === activeProvider.id) &&
    !resolveModelProviderPresetSource(activeProvider)
  )
  const activeKunProviderId: string = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const providerProxy = provider.proxy ?? { enabled: false, url: '' }

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let revision = 0
    const refresh = async (): Promise<void> => {
      try {
        const snapshot = revision === 0
          ? await requestSharedModelConnections('/v1/model-connections')
          : await window.kunGui.runtimeRequest(
              `/v1/model-connections/events?since_revision=${revision}&wait_ms=25000`,
              'GET'
            ).then((result) => {
              if (!result.ok) throw new Error(`Shared model connection event failed (HTTP ${result.status})`)
              return parseSharedModelConnectionEvent(result.body)
            })
        if (!disposed) {
          revision = snapshot.revision
          setSharedConnections(snapshot)
          setSharedConnectionsError('')
          const current = sharedProjectionInput.current
          pendingSharedProviderDeletions.current = reconcilePendingSharedProviderDeletions(
            snapshot,
            pendingSharedProviderDeletions.current
          )
          pendingSharedProviderNames.current = reconcilePendingSharedProviderNames(
            snapshot,
            pendingSharedProviderNames.current
          )
          const projected = projectSharedModelConnections(
            current.provider,
            snapshot,
            pendingSharedProviderDeletions.current,
            pendingSharedProviderNames.current
          )
          const fingerprint = sharedSettingsFingerprint({
            providers: projected.provider.providers,
            providerId: projected.kun.providerId,
            model: projected.kun.model,
            proxy: projected.provider.proxy,
            routePools: projected.provider.routePools,
            localGateway: projected.provider.localGateway
          })
          sharedSyncFingerprint.current = fingerprint
          const currentFingerprint = sharedSettingsFingerprint({
            providers: current.provider.providers,
            providerId: current.kun.providerId,
            model: current.kun.model,
            proxy: current.provider.proxy,
            routePools: current.provider.routePools,
            localGateway: current.provider.localGateway
          })
          if (fingerprint !== currentFingerprint) {
            sharedProjectionPending.current = true
            current.update({
              provider: projected.provider,
              agents: { kun: projected.kun }
            })
          }
        }
      } catch (error) {
        if (!disposed) setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!disposed) timer = setTimeout(refresh, revision === 0 ? 2_000 : 0)
      }
    }
    void refresh()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (saveStatus !== 'saved' || !sharedConnections) return
    const fingerprint = sharedSettingsFingerprint({
      providers: modelProviders,
      providerId: kun.providerId,
      model: kun.model,
      proxy: provider.proxy,
      routePools: provider.routePools,
      localGateway: provider.localGateway
    })
    if (sharedProjectionPending.current) {
      if (fingerprint === sharedSyncFingerprint.current) {
        sharedProjectionPending.current = false
      }
      return
    }
    if (fingerprint === sharedSyncFingerprint.current) return
    let disposed = false
    const syncOnce = async (): Promise<void> => {
      if (disposed) return
      let snapshot = await requestSharedModelConnections('/v1/model-connections')
      if (disposed) return
      const desiredProviders = sharedProvidersEligibleForSync(
        modelProviders,
        pendingSharedProviderDeletions.current
      ).filter((item) =>
        (
          item.id !== DEFAULT_MODEL_PROVIDER_ID ||
          snapshot.providers.some((entry) => entry.id === item.id) ||
          dirtyCredentialProviderIds.current.has(item.id) ||
          kun.providerId === item.id
        )
      )
      for (const item of desiredProviders) {
        if (disposed || pendingSharedProviderDeletions.current.has(item.id)) continue
        const baseUrlOptional =
          item.kind === 'agent-sdk' ||
          item.kind === 'antigravity-cli' ||
          item.kind === 'cursor-sdk'
        if (!baseUrlOptional && !item.baseUrl.trim()) continue
        const existing = snapshot.providers.find((entry) => entry.id === item.id)
        const selectedModel = item.models.includes(kun.model) ? kun.model : item.models[0]
        if (!existing) {
          if (pendingSharedProviderDeletions.current.has(item.id)) continue
          snapshot = await requestSharedModelConnections('/v1/model-connections/connect', 'POST', {
            expectedRevision: snapshot.revision,
            id: item.id,
            name: item.name.trim() || item.id,
            kind: item.kind ?? 'http',
            authType: isSubscriptionProvider(item) ? 'subscription' : 'api-key',
            ...(baseUrlOptional ? {} : { baseUrl: item.baseUrl }),
            endpointFormat: item.endpointFormat,
            ...(item.apiKey.trim() ? { credential: item.apiKey } : {}),
            models: item.models,
            modelCapabilities: sharedCapabilitiesFromProvider(item),
            ...(selectedModel ? { selectedModel } : {}),
            probe: false,
            select: false
          })
        } else {
          const modelCapabilities = sharedCapabilitiesFromProvider(item)
          const needsPatch =
            existing.name !== (item.name.trim() || item.id) ||
            (existing.baseUrl ?? '') !== item.baseUrl ||
            existing.endpointFormat !== item.endpointFormat ||
            existing.kind !== (item.kind ?? 'http') ||
            JSON.stringify(existing.models) !== JSON.stringify(item.models) ||
            JSON.stringify(existing.modelCapabilities ?? {}) !== JSON.stringify(modelCapabilities ?? {}) ||
            existing.selectedModel !== selectedModel
          if (needsPatch) {
            if (pendingSharedProviderDeletions.current.has(item.id)) continue
            const canonicalName = item.name.trim() || item.id
            snapshot = await requestSharedModelConnections(
              `/v1/model-connections/${encodeURIComponent(item.id)}`,
              'PATCH',
              {
                expectedRevision: snapshot.revision,
                name: canonicalName,
                kind: item.kind ?? 'http',
                authType: isSubscriptionProvider(item) ? 'subscription' : 'api-key',
                ...(baseUrlOptional ? {} : { baseUrl: item.baseUrl }),
                endpointFormat: item.endpointFormat,
                models: item.models,
                modelCapabilities,
                ...(selectedModel ? { selectedModel } : {})
              }
            )
            const pendingName = pendingSharedProviderNames.current.get(item.id)
            if (pendingName?.canonicalName === canonicalName) {
              pendingSharedProviderNames.current.set(item.id, {
                ...pendingName,
                committedRevision: snapshot.revision
              })
            }
          }
          if (dirtyCredentialProviderIds.current.has(item.id)) {
            if (pendingSharedProviderDeletions.current.has(item.id)) continue
            snapshot = item.apiKey.trim()
              ? await requestSharedModelConnections(
                  `/v1/model-connections/${encodeURIComponent(item.id)}/credential`,
                  'PUT',
                  { expectedRevision: snapshot.revision, credential: item.apiKey }
                )
              : await requestSharedModelConnections(
                  `/v1/model-connections/${encodeURIComponent(item.id)}/credential?expected_revision=${snapshot.revision}`,
                  'DELETE'
                )
            dirtyCredentialProviderIds.current.delete(item.id)
          }
        }
      }
      for (const existing of [...snapshot.providers]) {
        if (!pendingSharedProviderDeletions.current.has(existing.id)) continue
        snapshot = await requestSharedModelConnections(
          `/v1/model-connections/${encodeURIComponent(existing.id)}?expected_revision=${snapshot.revision}`,
          'DELETE'
        )
        pendingSharedProviderDeletions.current.set(existing.id, snapshot.revision)
        dirtyCredentialProviderIds.current.delete(existing.id)
      }
      const globalsChanged =
        JSON.stringify(snapshot.proxy) !== JSON.stringify(provider.proxy ?? { enabled: false, url: '' }) ||
        JSON.stringify(snapshot.routePools) !== JSON.stringify(provider.routePools ?? []) ||
        snapshot.localModelGateway?.enabled !== (provider.localGateway?.enabled === true)
      if (globalsChanged) {
        snapshot = await requestSharedModelConnections('/v1/model-connections', 'PATCH', {
          expectedRevision: snapshot.revision,
          proxy: provider.proxy ?? { enabled: false, url: '' },
          routePools: provider.routePools ?? [],
          localModelGateway: { enabled: provider.localGateway?.enabled === true }
        })
      }
      const active = snapshot.providers.find((entry) => entry.id === kun.providerId)
      const model = active && (active.models.includes(kun.model) ? kun.model : active.models[0])
      if (active?.configured && model && !pendingSharedProviderDeletions.current.has(active.id) && (
        snapshot.defaultProviderId !== active.id || snapshot.defaultModel !== model
      )) {
        snapshot = await requestSharedModelConnections('/v1/model-connections/select', 'POST', {
          expectedRevision: snapshot.revision,
          providerId: active.id,
          accountId: active.accountId,
          model
        })
      }
      if (!disposed) {
        sharedSyncFingerprint.current = fingerprint
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
      }
    }
    const sync = async (): Promise<void> => {
      try {
        await enqueueSharedMutation(syncOnce)
      } catch (error) {
        if (error instanceof SharedModelConnectionConflictError && !disposed) {
          setSharedConnections(error.snapshot)
          throw new Error('Model settings changed in another client. The latest revision was loaded; review and save again.')
        }
        throw error
      }
    }
    void sync().catch((error) => {
      if (!disposed) setSharedConnectionsError(error instanceof Error ? error.message : String(error))
    })
    return () => { disposed = true }
  }, [
    kun.model,
    kun.providerId,
    modelProviders,
    provider.localGateway,
    provider.proxy,
    provider.routePools,
    saveStatus,
    sharedConnections,
    enqueueSharedMutation
  ])

  const selectSharedModel = async (connection: SharedModelConnection, model: string): Promise<void> => {
    try {
      await enqueueSharedMutation(async () => {
        const snapshot = await selectSharedModelConnection(
          connection.id,
          model,
          (providerId) => pendingSharedProviderDeletions.current.has(providerId)
        )
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
        update({ agents: { kun: { providerId: connection.id, model } } })
      })
    } catch (error) {
      if (error instanceof SharedModelConnectionConflictError) {
        setSharedConnections(error.snapshot)
      }
      setSharedConnectionsError(error instanceof Error ? error.message : String(error))
    }
  }

  const updateProviderProxy = (patch: Partial<typeof providerProxy>): void => {
    update({
      provider: {
        proxy: {
          ...providerProxy,
          ...patch
        }
      }
    })
  }

  const setCapabilityExpanded = (capability: ProviderCapability, expanded: boolean): void => {
    setExpandedCapabilities((current) => {
      const next = new Set(current)
      if (expanded) next.add(capability)
      else next.delete(capability)
      return next
    })
  }

  const openAddProviderDialog = (): void => {
    setAddProviderQuery('')
    setSubscriptionRegion('all')
    setAddMenuOpen(true)
  }

  const closeAddProviderDialog = (): void => {
    setAddMenuOpen(false)
    window.setTimeout(() => addProviderButtonRef.current?.focus(), 0)
  }

  const handleAddProviderDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !addProviderDialogRef.current) return
    const focusable = Array.from(addProviderDialogRef.current.querySelectorAll<HTMLElement>([
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]'
    ].join(','))).filter((element) => element.getClientRects().length > 0)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleSubscriptionRegionTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentRegion: SubscriptionRegionFilter
  ): void => {
    const currentIndex = SUBSCRIPTION_REGION_TABS.findIndex((tab) => tab.id === currentRegion)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SUBSCRIPTION_REGION_TABS.length
    else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SUBSCRIPTION_REGION_TABS.length) % SUBSCRIPTION_REGION_TABS.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = SUBSCRIPTION_REGION_TABS.length - 1
    else return

    event.preventDefault()
    setSubscriptionRegion(SUBSCRIPTION_REGION_TABS[nextIndex].id)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  const confirmAction = async (options: {
    message: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
  }): Promise<boolean> => {
    if (typeof window.kunGui?.confirmDialog === 'function') {
      return window.kunGui.confirmDialog(options)
    }
    return true
  }

  const updateModelProviders = (
    providers: ModelProviderProfileV1[],
    kunPatch?: KunRuntimeSettingsPatchV1
  ): void => {
    update(modelProvidersSettingsPatch({
      provider,
      providers,
      kun: kunPatch,
      currentKun: kun
    }))
  }

  const patchProviderProfile = (
    item: ModelProviderProfileV1,
    transform: (item: ModelProviderProfileV1) => ModelProviderProfileV1
  ): void => {
    if (draftProvider && item.id === draftProvider.id) {
      setDraftProvider(transform(draftProvider))
      return
    }
    updateModelProviders(modelProviders.map((existing) => existing.id === item.id ? transform(existing) : existing))
  }

  const updateModelProvider = (id: string, patch: Partial<ModelProviderProfileV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    if (
      !draftProvider &&
      Object.prototype.hasOwnProperty.call(patch, 'apiKey') &&
      patch.apiKey !== target.apiKey
    ) {
      dirtyCredentialProviderIds.current.add(id)
    }
    if (
      !draftProvider &&
      Object.prototype.hasOwnProperty.call(patch, 'name') &&
      typeof patch.name === 'string' &&
      patch.name !== target.name
    ) {
      pendingSharedProviderNames.current.set(id, {
        localName: patch.name,
        canonicalName: patch.name.trim() || id,
        committedRevision: null
      })
    }
    patchProviderProfile(target, (item) => ({ ...item, ...patch }))
  }

  const updateModelProviderImage = (id: string, patch: Partial<ModelProviderImageCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      image: {
        ...(item.image ?? defaultImageCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderImage = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { image: _image, ...rest } = item
      void _image
      return rest
    })
  }

  const updateModelProviderSpeech = (id: string, patch: Partial<ModelProviderSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      speech: {
        ...(item.speech ?? defaultSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { speech: _speech, ...rest } = item
      void _speech
      return rest
    })
  }

  const updateModelProviderTextToSpeech = (id: string, patch: Partial<ModelProviderTextToSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      textToSpeech: {
        ...(item.textToSpeech ?? defaultTextToSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderTextToSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { textToSpeech: _textToSpeech, ...rest } = item
      void _textToSpeech
      return rest
    })
  }

  const updateModelProviderMusic = (id: string, patch: Partial<ModelProviderMusicCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      music: {
        ...(item.music ?? defaultMusicCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderMusic = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { music: _music, ...rest } = item
      void _music
      return rest
    })
  }

  const updateModelProviderVideo = (id: string, patch: Partial<ModelProviderVideoCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      video: {
        ...(item.video ?? defaultVideoCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderVideo = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { video: _video, ...rest } = item
      void _video
      return rest
    })
  }

  const updateModelProviderId = (id: string, value: string): void => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const nextId = normalizeModelProviderId(value)
    if (!nextId || nextId === id) return
    if (displayProviders.some((item) => item.id === nextId && item.id !== id)) return
    if (draftProvider && id === draftProvider.id) {
      setSelectedProviderId(nextId)
      setDraftProvider({ ...draftProvider, id: nextId })
      return
    }
    setSelectedProviderId(nextId)
    updateModelProviders(
      modelProviders.map((item) => item.id === id ? { ...item, id: nextId } : item),
      kun.providerId === id ? { providerId: nextId } : undefined
    )
  }

  const startProviderDraft = (profile: ModelProviderProfileV1): void => {
    previousProviderSelectionRef.current = selectedProviderId
    setDraftProvider(profile)
    setSelectedProviderId(profile.id)
    setActiveTab('connection')
  }

  const commitProviderDraft = (): void => {
    if (!draftProvider) return
    const hasKey = Boolean(draftProvider.apiKey.trim())
    clearPendingSharedProviderDeletionForExplicitAdd(
      pendingSharedProviderDeletions.current,
      draftProvider.id
    )
    updateModelProviders(
      [...modelProviders, draftProvider],
      hasKey
        ? { providerId: draftProvider.id, model: draftProvider.models[0] ?? kun.model }
        : undefined
    )
    previousProviderSelectionRef.current = null
    setDraftProvider(null)
    setSelectedProviderId(draftProvider.id)
  }

  const cancelProviderDraft = (): void => {
    if (!draftProvider) return
    const previousProviderId = previousProviderSelectionRef.current
    const fallbackProviderId = modelProviders.some((item) => item.id === activeKunProviderId)
      ? activeKunProviderId
      : modelProviders[0]?.id ?? DEFAULT_MODEL_PROVIDER_ID
    setDraftProvider(null)
    setSelectedProviderId(
      previousProviderId && modelProviders.some((item) => item.id === previousProviderId)
        ? previousProviderId
        : fallbackProviderId
    )
    previousProviderSelectionRef.current = null
  }

  const addModelProvider = (): void => {
    const baseId = 'custom-provider'
    let index = modelProviders.length + 1
    let id = `${baseId}-${index}`
    const used = new Set(displayProviders.map((item) => item.id))
    while (used.has(id)) {
      index += 1
      id = `${baseId}-${index}`
    }
    startProviderDraft({
      id,
      name: t('modelProviderNewName', { index }),
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions',
      retry: defaultModelRequestRetrySettings(),
      models: [],
      modelProfiles: {}
    })
  }

  const addPresetModelProvider = async (
    preset: ModelProviderPreset,
    mode: ModelProviderPresetMode = 'api'
  ): Promise<void> => {
    if (isMultiAccountProviderPreset(preset, mode)) {
      const accountProvider = modelProviderPresetAccountProfile(preset, mode, displayProviders)
      if (accountProvider) startProviderDraft(accountProvider)
      return
    }
    const presetProvider = mode === 'token-plan'
      ? modelProviderTokenPlanProfile(preset)
      : modelProviderPresetProfile(preset)
    if (!presetProvider) return
    const existingProvider = modelProviders.find((item) => item.id === presetProvider.id)
    if (existingProvider) {
      const confirmed = await confirmAction({
        message: t('modelProviderUpdatePresetTitle', { name: presetProvider.name }),
        detail: t('modelProviderUpdatePresetDetail'),
        confirmLabel: t('modelProviderUpdatePresetAction'),
        cancelLabel: t('modelProviderCancel')
      })
      if (!confirmed) {
        setSelectedProviderId(presetProvider.id)
        return
      }
    }
    if (!existingProvider) {
      startProviderDraft(presetProvider)
      return
    }
    const nextProvider: ModelProviderProfileV1 = {
      ...presetProvider,
      name: existingProvider.name.trim() || presetProvider.name,
      apiKey: existingProvider.apiKey,
      models: mergeProviderModelIds(presetProvider.models, existingProvider.models),
      modelProfiles: {
        ...existingProvider.modelProfiles,
        ...presetProvider.modelProfiles
      },
      image: presetProvider.image ?? existingProvider.image,
      speech: presetProvider.speech ?? existingProvider.speech,
      textToSpeech: presetProvider.textToSpeech ?? existingProvider.textToSpeech,
      music: presetProvider.music ?? existingProvider.music,
      video: presetProvider.video ?? existingProvider.video
    }
    const nextProviders = modelProviders.map((item) => item.id === presetProvider.id ? nextProvider : item)
    setSelectedProviderId(nextProvider.id)
    updateModelProviders(
      nextProviders,
      nextProvider.apiKey.trim()
        ? { providerId: nextProvider.id, model: nextProvider.models[0] ?? kun.model }
        : undefined
    )
  }

  const removeModelProvider = async (id: string): Promise<void> => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const target = modelProviders.find((item) => item.id === id)
    if (!target) return
    const usedByChat = activeKunProviderId === id
    const usedByImage = (kun.imageGeneration?.providerId ?? '').trim() === id
    const usedBySpeech = (kun.speechToText?.providerId ?? '').trim() === id
    const usedByTextToSpeech = (kun.textToSpeech?.providerId ?? '').trim() === id
    const usedByMusic = (kun.musicGeneration?.providerId ?? '').trim() === id
    const usedByVideo = (kun.videoGeneration?.providerId ?? '').trim() === id
    const writeInline = form?.write?.inlineCompletion
    const usedByWrite = Boolean(
      writeInline && !writeInline.inheritProvider && writeInline.providerId === id
    )
    const references = [
      ...(usedByChat ? [t('modelProviderDeleteInUseChat')] : []),
      ...(usedByImage ? [t('modelProviderDeleteInUseImage')] : []),
      ...(usedBySpeech ? [t('modelProviderDeleteInUseSpeech')] : []),
      ...(usedByTextToSpeech ? [t('modelProviderDeleteInUseTextToSpeech')] : []),
      ...(usedByMusic ? [t('modelProviderDeleteInUseMusic')] : []),
      ...(usedByVideo ? [t('modelProviderDeleteInUseVideo')] : []),
      ...(usedByWrite ? [t('modelProviderDeleteInUseWrite')] : [])
    ]
    const confirmed = await confirmAction({
      message: t('modelProviderDeleteConfirmTitle', { name: target.name.trim() || target.id }),
      detail: [t('modelProviderDeleteConfirmDetail'), ...references].join('\n'),
      confirmLabel: t('modelProviderDeleteAction'),
      cancelLabel: t('modelProviderCancel')
    })
    if (!confirmed) return
    pendingSharedProviderDeletions.current.set(id, null)
    try {
      const snapshot = await enqueueSharedMutation(() => deleteSharedModelConnection(id))
      pendingSharedProviderDeletions.current.set(id, snapshot.revision)
      pendingSharedProviderNames.current.delete(id)
      dirtyCredentialProviderIds.current.delete(id)
      setSharedConnections(snapshot)
      setSharedConnectionsError('')
    } catch (error) {
      pendingSharedProviderDeletions.current.delete(id)
      setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      return
    }
    // The canonical delete can wait behind an in-flight registry sync. Build
    // the local patch from the latest settings after that wait so unrelated
    // edits made while the request was pending are not overwritten.
    const latest = sharedProjectionInput.current
    const latestProviders = latest.provider.providers as ModelProviderProfileV1[]
    const latestKun = latest.kun as KunRuntimeSettingsV1
    const latestUsedByChat = (latestKun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID) === id
    const latestUsedByImage = (latestKun.imageGeneration?.providerId ?? '').trim() === id
    const latestUsedBySpeech = (latestKun.speechToText?.providerId ?? '').trim() === id
    const latestUsedByTextToSpeech = (latestKun.textToSpeech?.providerId ?? '').trim() === id
    const latestUsedByMusic = (latestKun.musicGeneration?.providerId ?? '').trim() === id
    const latestUsedByVideo = (latestKun.videoGeneration?.providerId ?? '').trim() === id
    const latestWriteInline = latest.form?.write?.inlineCompletion
    const latestUsedByWrite = Boolean(
      latestWriteInline && !latestWriteInline.inheritProvider && latestWriteInline.providerId === id
    )
    const nextProviders = latestProviders.filter((item) => item.id !== id)
    const kunPatch: KunRuntimeSettingsPatchV1 | undefined =
      latestUsedByChat || latestUsedByImage || latestUsedBySpeech || latestUsedByTextToSpeech || latestUsedByMusic || latestUsedByVideo
        ? {
            ...(latestUsedByChat ? { providerId: DEFAULT_MODEL_PROVIDER_ID } : {}),
            ...(latestUsedByImage ? { imageGeneration: { providerId: '' } } : {}),
            ...(latestUsedBySpeech ? { speechToText: { providerId: '' } } : {}),
            ...(latestUsedByTextToSpeech ? { textToSpeech: { providerId: '' } } : {}),
            ...(latestUsedByMusic ? { musicGeneration: { providerId: '' } } : {}),
            ...(latestUsedByVideo ? { videoGeneration: { providerId: '' } } : {})
          }
        : undefined
    const patch = modelProvidersSettingsPatch({
      provider: latest.provider,
      providers: nextProviders,
      kun: kunPatch,
      currentKun: latestKun
    })
    if (latestUsedByWrite) {
      patch.write = { inlineCompletion: { inheritProvider: true, providerId: '' } }
    }
    setSelectedProviderId(DEFAULT_MODEL_PROVIDER_ID)
    latest.update(patch)
  }

  const fetchModelsDevCatalogFor = async (
    target: ModelProviderProfileV1,
    modelHints?: CursorSubscriptionModel[],
    forceRefresh = true
  ): Promise<ModelsDevCatalogResult> => {
    if (typeof window.kunGui?.fetchModelsDevCatalog !== 'function') {
      return { status: 'error', message: 'models.dev catalog bridge is unavailable.', models: [] }
    }
    try {
      const source = resolveModelProviderPresetSource(target)
      return await window.kunGui.fetchModelsDevCatalog({
        // Multi-account profiles keep a unique runtime id, while catalog
        // matching must use the canonical preset id understood by models.dev.
        providerId: source
          ? source.mode === 'token-plan'
            ? tokenPlanProviderId(source.preset.id)
            : source.preset.id
          : target.id,
        baseUrl: target.baseUrl,
        forceRefresh,
        ...(modelHints?.length
          ? {
              modelHints: modelHints.map((model) => ({
                id: model.id,
                ...(model.aliases?.length ? { aliases: model.aliases } : {})
              }))
            }
          : {})
      })
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        models: []
      }
    }
  }

  const patchProviderProfileRef = useRef(patchProviderProfile)
  patchProviderProfileRef.current = patchProviderProfile
  const fetchModelsDevCatalogForRef = useRef(fetchModelsDevCatalogFor)
  fetchModelsDevCatalogForRef.current = fetchModelsDevCatalogFor

  useEffect(() => {
    if (
      activeTab !== 'models'
      || !activeProvider
      || !cursorProviderNeedsMetadataRepair(activeProvider)
    ) return

    const repairKey = [
      activeProvider.id,
      ...activeProvider.models.map((model) => model.trim().toLowerCase()).filter(Boolean)
    ].join('\u0001')
    if (cursorMetadataRepairAttempts.current.has(repairKey)) return
    cursorMetadataRepairAttempts.current.add(repairKey)

    void fetchModelsDevCatalogForRef.current(
      activeProvider,
      activeProvider.models.map((model) => ({
        id: model,
        displayName: model
      })),
      false
    ).then((catalogResult) => {
      if (catalogResult.status !== 'ok' || catalogResult.models.length === 0) return
      patchProviderProfileRef.current(activeProvider, (item) => {
        const modelProfiles = enrichCursorProviderModelProfiles(
          item,
          item.models,
          catalogResult.models
        )
        return modelProfiles === item.modelProfiles
          ? item
          : { ...item, modelProfiles }
      })
    })
  }, [activeProvider, activeTab])

  const openModelImport = (input: {
    target: ModelProviderProfileV1
    fingerprint: string
    providerModelIds: string[]
    modelAliases?: Record<string, string[]>
    discoveredModelProfiles?: Record<string, ModelProviderModelProfileV1>
    catalogResult: ModelsDevCatalogResult
    providerError?: string
    latencyMs?: number
    authoritative?: boolean
  }): void => {
    const catalogOnlyIds = input.catalogResult.status === 'ok' && input.catalogResult.matchMode === 'catalog'
      ? input.catalogResult.models.map((model) => model.id)
      : []
    const total = mergeProviderModelIds(input.providerModelIds, catalogOnlyIds).length
    const hasUsableEntries = input.providerModelIds.length > 0 || catalogOnlyIds.length > 0
    if (!hasUsableEntries) {
      const catalogMessage = input.catalogResult.status === 'error'
        ? input.catalogResult.message
        : input.catalogResult.status === 'unmapped'
          ? t('providerModelImportCatalogUnmapped')
          : t('modelProviderFetchEmpty')
      const message = [input.providerError, catalogMessage].filter(Boolean).join(' · ')
      setProbeStates((previous) => ({
        ...previous,
        [input.target.id]: {
          fingerprint: input.fingerprint,
          mode: 'fetch',
          status: 'error',
          message: message || t('modelProviderFetchEmpty')
        }
      }))
      return
    }

    setProbeStates((previous) => ({
      ...previous,
      [input.target.id]: {
        fingerprint: input.fingerprint,
        mode: 'fetch',
        status: 'ok',
        latencyMs: input.latencyMs ?? 0,
        total
      }
    }))
    setPendingImport({
      providerId: input.target.id,
      providerModelIds: input.providerModelIds,
      ...(input.modelAliases ? { modelAliases: input.modelAliases } : {}),
      ...(input.discoveredModelProfiles
        ? { discoveredModelProfiles: input.discoveredModelProfiles }
        : {}),
      catalogResult: input.catalogResult,
      ...(input.providerError ? { providerError: input.providerError } : {}),
      ...(input.authoritative ? { authoritative: true } : {})
    })
  }

  const runProbe = async (target: ModelProviderProfileV1, mode: 'test' | 'fetch'): Promise<void> => {
    const fingerprint = providerConnectionFingerprint(target)
    if (isCursorSubscriptionProvider(target)) {
      if (!target.apiKey.trim()) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: t('modelProviderPresetMissingKeyForProbe')
          }
        }))
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      try {
        const discover = window.kunGui?.cursorSubscriptionDiscover
        if (typeof discover !== 'function') {
          throw new Error(`No bridge registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
        }
        const discovery = await discover(target.apiKey)
        const accountName = [
          discovery.account.userFirstName,
          discovery.account.userLastName
        ].filter(Boolean).join(' ')
        setCursorAccounts((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            label: discovery.account.userEmail || accountName || discovery.account.apiKeyName,
            apiKeyName: discovery.account.apiKeyName
          }
        }))
        if (mode === 'fetch') {
          const modelIds = discovery.models.map((model) => model.id)
          const modelAliases = Object.fromEntries(
            discovery.models
              .filter((model) => model.aliases?.length)
              .map((model) => [model.id, [...(model.aliases ?? [])]])
          )
          openModelImport({
            target,
            fingerprint,
            providerModelIds: modelIds,
            modelAliases,
            catalogResult: await fetchModelsDevCatalogFor(target, discovery.models),
            providerError: modelIds.length === 0
              ? t('providerModelImportProviderReturnedEmpty')
              : undefined,
            latencyMs: 0,
            authoritative: true
          })
          return
        }
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'ok',
            latencyMs: 0,
            total: discovery.models.length
          }
        }))
      } catch (error) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: cursorSubscriptionDiscoveryErrorMessage(
              error,
              t('cursorSubscriptionRestartRequired')
            )
          }
        }))
      }
      return
    }
    // The official Antigravity CLI owns subscription auth and model discovery.
    if (isGeminiSubscriptionProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const [providerResult, catalogResult] = await Promise.all([
        window.kunGui.geminiSubscriptionModels()
          .then((catalog) => ({
            catalog,
            error: undefined as string | undefined
          }))
          .catch((error: unknown) => ({
            catalog: { models: [] } satisfies AntigravitySubscriptionModelCatalog,
            error: error instanceof Error ? error.message : String(error)
          })),
        fetchModelsDevCatalogFor(target)
      ])
      const providerPatch = antigravityProviderCatalogPatch(
        providerResult.catalog,
        target.modelProfiles
      )
      if (mode === 'fetch') {
        openModelImport({
          target,
          fingerprint,
          providerModelIds: providerPatch.models,
          discoveredModelProfiles: providerPatch.modelProfiles,
          catalogResult,
          providerError: providerResult.error,
          latencyMs: 0,
          authoritative: true
        })
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: providerResult.error
          ? { fingerprint, mode, status: 'error', message: providerResult.error }
          : { fingerprint, mode, status: 'ok', latencyMs: 0, total: providerPatch.models.length }
      }))
      return
    }
    if (isGeminiCliApiSubscriptionProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const [statusResult, modelResult, catalogResult] = await Promise.all([
        window.kunGui.geminiCliSubscriptionStatus()
          .catch(() => ({ installed: false, authenticated: false })),
        window.kunGui.geminiCliSubscriptionModels()
          .then((modelIds) => ({ modelIds, error: undefined as string | undefined }))
          .catch((error: unknown) => ({
            modelIds: [] as string[],
            error: error instanceof Error ? error.message : String(error)
          })),
        fetchModelsDevCatalogFor(target)
      ])
      const authError = statusResult.authenticated
        ? undefined
        : t('geminiCliApiLoginHint')
      if (mode === 'fetch') {
        openModelImport({
          target,
          fingerprint,
          providerModelIds: modelResult.modelIds,
          catalogResult,
          providerError: modelResult.error ?? authError,
          latencyMs: 0,
          authoritative: true
        })
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: statusResult.authenticated
          ? {
              fingerprint,
              mode,
              status: 'ok',
              latencyMs: 0,
              total: modelResult.modelIds.length
            }
          : {
              fingerprint,
              mode,
              status: 'error',
              message: authError
            }
      }))
      return
    }
    // Subscription (agent-sdk) providers have no HTTP /models endpoint. Model
    // enumeration remains a catalog operation, while Test makes a bounded real
    // request through the official Claude transport so a non-empty/revoked token
    // can never produce a false success state.
    if (isAgentSdkProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      if (mode === 'fetch') {
        const [providerResult, catalogResult] = await Promise.all([
          window.kunGui.claudeSubscriptionModels(target.apiKey.trim() || undefined)
            .then((modelIds) => ({ modelIds, error: undefined as string | undefined }))
            .catch((error: unknown) => ({
              modelIds: [] as string[],
              error: error instanceof Error ? error.message : String(error)
            })),
          fetchModelsDevCatalogFor(target)
        ])
        openModelImport({
          target,
          fingerprint,
          providerModelIds: [...providerResult.modelIds],
          catalogResult,
          providerError: providerResult.error
            ?? (providerResult.modelIds.length === 0 ? t('claudeSubProbeNotReady') : undefined),
          latencyMs: 0
        })
        return
      }
      const result = await window.kunGui.claudeSubscriptionProbe(
        target.apiKey.trim() || undefined
      ).catch((error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }))
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: result.ok
          ? {
              fingerprint,
              mode,
              status: 'ok',
              latencyMs: result.latencyMs,
              total: target.models.length
            }
          : {
              fingerprint,
              mode,
              status: 'error',
              message: result.message === 'invalid-token-format'
                ? t('claudeSubTokenInvalid')
                : result.message === 'probe-timeout'
                  ? t('claudeSubProbeTimeout')
                  : result.message === 'claude-cli-not-found'
                    ? t('claudeSubLoginFailedCli')
                    : result.message || t('claudeSubProbeNotReady')
            }
      }))
      return
    }
    const sharedConnection = sharedConnectionFor(target.id)
    if (
      modelProviderRequiresApiKey(target) &&
      !target.apiKey.trim() &&
      sharedConnection?.configured
    ) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const startedAt = performance.now()
      try {
        const snapshot = await requestSharedModelConnections(
          `/v1/model-connections/${encodeURIComponent(target.id)}/probe`,
          'POST',
          { expectedRevision: sharedConnections?.revision ?? 0 }
        )
        setSharedConnections(snapshot)
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'ok',
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
            total: sharedConnection.models.length
          }
        }))
      } catch (error) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          }
        }))
      }
      return
    }
    if (modelProviderRequiresApiKey(target) && !target.apiKey.trim()) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: {
          fingerprint,
          mode,
          status: 'error',
          message: t('modelProviderPresetMissingKeyForProbe')
        }
      }))
      return
    }
    if (typeof window.kunGui?.probeModelProvider !== 'function') return
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: { fingerprint, mode, status: 'busy' }
    }))

    const probe = async (): Promise<ModelProviderProbeResult> => {
      try {
        return await window.kunGui.probeModelProvider({
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          endpointFormat: target.endpointFormat
        })
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }

    if (mode === 'fetch') {
      const [result, catalogResult] = await Promise.all([
        probe(),
        fetchModelsDevCatalogFor(target)
      ])
      openModelImport({
        target,
        fingerprint,
        providerModelIds: result.ok ? [...result.modelIds] : [],
        catalogResult,
        providerError: result.ok
          ? (result.modelIds.length === 0 ? t('providerModelImportProviderReturnedEmpty') : undefined)
          : result.message,
        latencyMs: result.ok ? result.latencyMs : 0
      })
      return
    }

    const result = await probe()
    if (!result.ok) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'error', message: result.message }
      }))
      return
    }
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: {
        fingerprint,
        mode,
        status: 'ok',
        latencyMs: result.latencyMs,
        total: result.modelIds.length
      }
    }))
  }

  const importPickedModels = (
    target: ModelProviderProfileV1,
    picked: ProviderModelImportResult,
    authoritative = false,
    modelAliases: Readonly<Record<string, readonly string[]>> = {},
    discoveredModelProfiles: Readonly<Record<string, ModelProviderModelProfileV1>> = {}
  ): void => {
    const nextChatModels = authoritative
      ? [...picked.chat]
      : mergeProviderModelIds(target.models, picked.chat)
    const nextImageModels = target.image
      ? mergeProviderModelIds(target.image.models, picked.image)
      : picked.image
    const nextSpeechModels = target.speech
      ? mergeProviderModelIds(target.speech.models, picked.speech)
      : picked.speech
    const nextTextToSpeechModels = target.textToSpeech
      ? mergeProviderModelIds(target.textToSpeech.models, picked.tts)
      : picked.tts
    const nextMusicModels = target.music
      ? mergeProviderModelIds(target.music.models, picked.music)
      : picked.music
    const nextVideoModels = target.video
      ? mergeProviderModelIds(target.video.models, picked.video)
      : picked.video
    const enrichedModelProfiles = isCursorSubscriptionProvider(target)
      ? enrichCursorProviderModelProfiles(
          target,
          nextChatModels,
          picked.catalogModels,
          modelAliases
        )
      : enrichProviderModelProfiles(
          target,
          nextChatModels,
          picked.catalogModels,
          modelAliases
        )
    const nextModelProfiles = Object.keys(discoveredModelProfiles).length > 0
      ? Object.fromEntries(nextChatModels.flatMap((modelId) => {
          const discoveredProfile = discoveredModelProfiles[modelId]
          const enrichedProfile = enrichedModelProfiles[modelId]
          const profile = discoveredProfile
            ? { ...enrichedProfile, ...discoveredProfile }
            : enrichedProfile
          return profile ? [[modelId, profile]] : []
        }))
      : enrichedModelProfiles
    const added =
      addedModelCount(target.models, nextChatModels)
      + addedModelCount(target.image?.models ?? [], nextImageModels)
      + addedModelCount(target.speech?.models ?? [], nextSpeechModels)
      + addedModelCount(target.textToSpeech?.models ?? [], nextTextToSpeechModels)
      + addedModelCount(target.music?.models ?? [], nextMusicModels)
      + addedModelCount(target.video?.models ?? [], nextVideoModels)
    if (authoritative || added > 0 || nextModelProfiles !== target.modelProfiles) {
      patchProviderProfile(target, (item) => ({
        ...item,
        models: nextChatModels,
        modelProfiles: nextModelProfiles,
        ...(nextImageModels.length > 0
          ? { image: { ...(item.image ?? presetImageCapability(item) ?? defaultImageCapability(item.baseUrl)), models: nextImageModels } }
          : {}),
        ...(nextSpeechModels.length > 0
          ? { speech: { ...(item.speech ?? presetSpeechCapability(item) ?? defaultSpeechCapability(item.baseUrl)), models: nextSpeechModels } }
          : {}),
        ...(nextTextToSpeechModels.length > 0
          ? { textToSpeech: { ...(item.textToSpeech ?? presetTextToSpeechCapability(item) ?? defaultTextToSpeechCapability(item.baseUrl)), models: nextTextToSpeechModels } }
          : {}),
        ...(nextMusicModels.length > 0
          ? { music: { ...(item.music ?? presetMusicCapability(item) ?? defaultMusicCapability(item.baseUrl)), models: nextMusicModels } }
          : {}),
        ...(nextVideoModels.length > 0
          ? { video: { ...(item.video ?? presetVideoCapability(item) ?? defaultVideoCapability(item.baseUrl)), models: nextVideoModels } }
          : {})
      }))
    }
    setProbeStates((prev) => {
      const previous = prev[target.id]
      if (!previous) return prev
      return {
        ...prev,
        [target.id]: { ...previous, total: added }
      }
    })
  }

  const activeProbe = activeProvider ? probeStates[activeProvider.id] : undefined
  const activeProbeFresh = Boolean(
    activeProvider &&
    activeProbe &&
    activeProbe.fingerprint === providerConnectionFingerprint(activeProvider)
  )
  const probeBusy = Boolean(activeProbeFresh && activeProbe?.status === 'busy')
  const probeNotice: InlineNotice | null = (() => {
    if (!activeProbeFresh || !activeProbe) return null
    if (activeProbe.status === 'busy') {
      return { tone: 'info', message: t('modelProviderTesting') }
    }
    if (activeProbe.status === 'error') {
      return { tone: 'error', message: t('modelProviderTestFailed', { message: activeProbe.message ?? '' }) }
    }
    return {
      tone: 'success',
      message: activeProbe.mode === 'fetch'
        ? t('modelProviderFetchedModels', { total: activeProbe.total ?? 0 })
        : t('modelProviderTestSuccess', { latency: activeProbe.latencyMs ?? 0, total: activeProbe.total ?? 0 })
    }
  })()
  const activeBaseUrlInvalid = Boolean(activeProvider && !isAcceptableHttpUrl(activeProvider.baseUrl))
  const activeImageBaseUrlInvalid = Boolean(
    activeProvider?.image && !isAcceptableHttpUrl(activeProvider.image.baseUrl)
  )
  const activeSpeechBaseUrlInvalid = Boolean(
    activeProvider?.speech &&
    activeProvider.speech.protocol !== 'gemini-cli-audio' &&
    activeProvider.speech.protocol !== 'local-whisper' &&
    !isAcceptableHttpUrl(activeProvider.speech.baseUrl)
  )
  const activePresetSpeechCapability = activeProvider
    ? presetSpeechCapability(activeProvider)
    : null
  const activeSpeechToggleDisabled = Boolean(
    activePresetSpeechCapability ||
    (
      activeProvider &&
      !activeProvider.speech &&
      (isDelegatedEndpointProvider(activeProvider) || isOAuthSubscriptionProvider(activeProvider))
    )
  )
  const activeTextToSpeechBaseUrlInvalid = Boolean(
    activeProvider?.textToSpeech && !isAcceptableHttpUrl(activeProvider.textToSpeech.baseUrl)
  )
  const activeMusicBaseUrlInvalid = Boolean(
    activeProvider?.music && !isAcceptableHttpUrl(activeProvider.music.baseUrl)
  )
  const activeVideoBaseUrlInvalid = Boolean(
    activeProvider?.video && !isAcceptableHttpUrl(activeProvider.video.baseUrl)
  )
  const activeMissingCredential = Boolean(
    activeProvider &&
    modelProviderRequiresApiKey(activeProvider) &&
    !hasConfiguredCredential(activeProvider)
  )
  const providerSetupNeedsApiKey = sharedProviderSetupNeedsApiKey(displayProviders, sharedConnections)
  const activeProbeBlocked = activeBaseUrlInvalid || activeMissingCredential
  const activeCursorAccount = activeProvider
    ? cursorAccounts[activeProvider.id]
    : undefined
  const activeCursorAccountFresh = Boolean(
    activeProvider
    && activeCursorAccount
    && activeCursorAccount.fingerprint === providerConnectionFingerprint(activeProvider)
  )
  const activeCursorApiKeyUrl = activeProvider && isCursorSubscriptionProvider(activeProvider)
    ? resolveModelProviderPresetSource(activeProvider)?.preset.apiKeyUrl
    : undefined
  const activeTokenPlanRegions = activeProvider
    ? tokenPlanPresetForProfile(activeProvider)?.tokenPlan?.regions ?? []
    : []

  const normalizedProviderListQuery = providerListQuery.trim().toLowerCase()
  const filteredProviders = normalizedProviderListQuery
    ? displayProviders.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(normalizedProviderListQuery)
      )
    : displayProviders
  const planProviders = filteredProviders.filter((item) => isSubscriptionProvider(item))
  const apiProviders = filteredProviders.filter((item) => !isSubscriptionProvider(item))
  // 只要存在任一套餐类供应商就分组展示;否则(通常只有默认 DeepSeek)保持单一平铺列表。
  const grouped = displayProviders.some((item) => isSubscriptionProvider(item))

  const renderProviderButton = (item: ModelProviderProfileV1): ReactElement => {
    const selected = activeProvider?.id === item.id
    const isDraft = draftProvider?.id === item.id
    const inUse = !isDraft && activeKunProviderId === item.id
    const configuredCredential = hasConfiguredCredential(item)
    const missingKey = modelProviderRequiresApiKey(item) && !configuredCredential
    return (
      <button
        key={item.id}
        type="button"
        aria-pressed={selected}
        onClick={() => setSelectedProviderId(item.id)}
        className={`group relative min-h-[58px] w-full min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
          selected
            ? 'border-accent/20 bg-accent/[0.08]'
            : 'border-transparent hover:border-ds-border-muted hover:bg-ds-hover'
        }`}
      >
        {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
            selected
              ? 'border-accent/20 bg-ds-card text-accent'
              : 'border-ds-border-muted bg-ds-main/45 text-ds-faint group-hover:text-ds-muted'
          }`}>
            <ServerCog className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">
                {item.name.trim() || item.id}
              </span>
              {configuredCredential ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title={t('modelProviderReady')} />
              ) : null}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11.5px] text-ds-faint">
              {inUse ? <span>{t('modelProviderInUse')}</span> : null}
              {inUse ? <span aria-hidden="true">·</span> : null}
              <span>{t('modelProviderModelCount', { total: providerModelCount(item) })}</span>
              {item.models.some((model) =>
                modelSupportsImageInput(profileForModel(item, model))
              ) ? <ImageIcon className="h-3 w-3 shrink-0" strokeWidth={1.9} /> : null}
            </span>
          </span>
          {isDraft ? <ProviderBadge tone="warning">{t('modelProviderDraftBadge')}</ProviderBadge> : null}
          {!isDraft && missingKey ? (
            <span className="inline-flex shrink-0 items-center text-amber-500" title={t('modelProviderMissingKey')}>
              <AlertCircle className="h-4 w-4" />
              <span className="sr-only">{t('modelProviderMissingKey')}</span>
            </span>
          ) : null}
        </div>
      </button>
    )
  }

  const addMenuEntries = MODEL_PROVIDER_PRESETS.flatMap((preset) => {
    const entries: {
      preset: ModelProviderPreset
      mode: ModelProviderPresetMode
      profileId: string
      label: string
      group: 'subscription' | 'api'
      region?: ModelProviderSubscriptionRegion
    }[] = [
      {
        preset,
        mode: 'api',
        profileId: preset.id,
        label: preset.name,
        group: preset.category === 'subscription' ? 'subscription' : 'api',
        region: preset.subscriptionRegion
      }
    ]
    if (preset.tokenPlan) {
      entries.push({
        preset,
        mode: 'token-plan',
        profileId: tokenPlanProviderId(preset.id),
        label: `${preset.name} · Token Plan`,
        group: 'subscription',
        region: preset.subscriptionRegion
      })
    }
    return entries
  })
  const normalizedAddProviderQuery = addProviderQuery.trim().toLowerCase()
  const visibleAddEntries = normalizedAddProviderQuery
    ? addMenuEntries.filter((entry) =>
        `${entry.label} ${entry.profileId}`.toLowerCase().includes(normalizedAddProviderQuery)
      )
    : addMenuEntries
  const queriedPlanAddEntries = visibleAddEntries.filter((entry) => entry.group === 'subscription')
  const planAddEntries = subscriptionRegion === 'all'
    ? queriedPlanAddEntries
    : queriedPlanAddEntries.filter((entry) => entry.region === subscriptionRegion)
  const apiAddEntries = visibleAddEntries.filter((entry) => entry.group === 'api')
  const showPlanAddGroup = queriedPlanAddEntries.length > 0 || !normalizedAddProviderQuery
  const renderAddEntry = (entry: (typeof addMenuEntries)[number]): ReactElement => {
    const multiAccount = isMultiAccountProviderPreset(entry.preset, entry.mode)
    const accountCount = multiAccount
      ? modelProviderPresetAccountCount(entry.preset, entry.mode, modelProviders)
      : 0
    const exists = !multiAccount && modelProviders.some((item) => item.id === entry.profileId)
    return (
      <button
        key={entry.profileId}
        type="button"
        onClick={() => {
          closeAddProviderDialog()
          void addPresetModelProvider(entry.preset, entry.mode)
        }}
        className="group grid min-h-20 w-full gap-2 rounded-xl border border-ds-border bg-ds-card px-3.5 py-3 text-left transition hover:border-accent/45 hover:bg-ds-hover"
      >
        <span className="flex min-w-0 items-start justify-between gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ds-ink">{entry.label}</span>
          <StatusPill tone={exists ? 'warning' : accountCount > 0 ? 'success' : 'muted'}>
            {accountCount > 0
              ? t('modelProviderAccountCount', { count: accountCount })
              : exists
              ? t('modelProviderPresetUpdateTag')
              : entry.group === 'subscription'
                ? t('modelProviderPlanBadge')
                : t('modelProviderPresetBadge')}
          </StatusPill>
        </span>
        <span className="truncate font-mono text-[11.5px] text-ds-faint">
          {entry.profileId}{multiAccount ? ` · ${t('modelProviderAddAccountHint')}` : ''}
        </span>
      </button>
    )
  }

  const pendingImportProvider = pendingImport
    ? displayProviders.find((item) => item.id === pendingImport.providerId)
    : null

  return (
    <>
      {providerSetupNeedsApiKey ? (
        <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
          <div className="text-[15px] font-semibold">{t('apiKeyRequiredTitle')}</div>
          <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
            {t('apiKeyRequiredBody')}
          </p>
        </div>
      ) : null}
      <section className="ds-provider-workspace overflow-hidden rounded-xl border border-ds-border bg-ds-card">
        <header className="grid min-h-[76px] border-b border-ds-border-muted lg:grid-cols-[268px_minmax(0,1fr)]">
          <div className="flex items-center justify-between gap-3 border-b border-ds-border-muted px-4 py-3 lg:border-b-0 lg:border-r">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-ds-ink">{t('providers')}</h2>
              <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
                {zh
                  ? `${displayProviders.length} 个已配置`
                  : `${displayProviders.length} configured`}
              </p>
            </div>
            {workspaceMode === 'providers' ? <button
              ref={addProviderButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={addMenuOpen}
              onClick={openAddProviderDialog}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink transition hover:border-accent/35 hover:bg-ds-hover"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              {t('modelProviderAdd')}
            </button> : null}
          </div>
          <div className="flex min-w-0 items-center px-4 py-3 sm:px-6">
            <SettingsTabs<ProviderWorkspaceMode>
              baseId="provider-workspace"
              ariaLabel={t('providers')}
              items={[
                { id: 'providers', label: t('modelProviderModeProviders'), icon: ServerCog },
                { id: 'routes', label: t('modelProviderModeRoutes'), icon: Route }
              ]}
              value={workspaceMode}
              onChange={setWorkspaceMode}
            />
          </div>
        </header>
        <SettingsTabPanel<ProviderWorkspaceMode>
          baseId="provider-workspace"
          tabId="providers"
          active={workspaceMode === 'providers'}
        >
          <div className="grid min-w-0">
            <label className="grid gap-1.5 px-4 py-4 lg:hidden">
            <span className="text-[12px] font-semibold text-ds-muted">{t('modelProviderCompactSelect')}</span>
            <select
              className={providerSelectControlClass}
              value={activeProvider?.id ?? ''}
              onChange={(event) => setSelectedProviderId(event.target.value)}
            >
              {displayProviders.map((item) => (
                <option key={item.id} value={item.id}>{item.name.trim() || item.id}</option>
              ))}
            </select>
          </label>
          <div className="grid min-w-0 lg:grid-cols-[268px_minmax(0,1fr)]">
            <aside className="hidden min-w-0 content-start gap-4 border-r border-ds-border-muted bg-ds-sidebar/45 p-4 lg:grid">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                  strokeWidth={1.9}
                />
                <input
                  value={providerListQuery}
                  onChange={(event) => setProviderListQuery(event.target.value)}
                  placeholder={t('modelProviderSearchPlaceholder')}
                  aria-label={t('modelProviderSearchPlaceholder')}
                  className="h-10 w-full rounded-lg border border-ds-border bg-ds-card pl-9 pr-3 text-[12.5px] text-ds-ink transition placeholder:text-ds-faint focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
                />
              </label>
              {grouped ? (
                <>
                  {planProviders.length > 0 ? (
                    <ProviderListGroup label={t('modelProviderGroupPlans')} count={planProviders.length}>
                      {planProviders.map(renderProviderButton)}
                    </ProviderListGroup>
                  ) : null}
                  {apiProviders.length > 0 ? (
                    <ProviderListGroup label={t('modelProviderGroupApi')} count={apiProviders.length}>
                      {apiProviders.map(renderProviderButton)}
                    </ProviderListGroup>
                  ) : null}
                </>
              ) : (
                <div className="grid gap-2">{apiProviders.map(renderProviderButton)}</div>
              )}
              {filteredProviders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-6 text-center text-[12px] text-ds-faint">
                  {t('modelProviderSearchEmpty', { query: providerListQuery.trim() })}
                </p>
              ) : null}
            </aside>
            {activeProvider ? (
              <div className="grid min-w-0 content-start gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ds-border-muted pb-5">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-faint">
                      <span>{t('providers')}</span>
                      <span aria-hidden="true">/</span>
                      <span className="truncate">{activeProvider.id}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                      <h2 className="min-w-0 truncate text-[28px] font-semibold leading-none tracking-[-0.025em] text-ds-ink">
                        {activeProvider.name.trim() || activeProvider.id}
                      </h2>
                      {isDraftActive ? (
                        <StatusPill tone="warning">{t('modelProviderDraftBadge')}</StatusPill>
                      ) : (
                        <StatusPill
                          tone={activeProbeBlocked ? 'warning' : 'success'}
                          icon={activeProbeBlocked
                            ? <AlertCircle className="h-3 w-3" />
                            : <CheckCircle2 className="h-3 w-3" strokeWidth={2} />}
                        >
                          {activeProbeBlocked ? t('modelProviderNeedsConfiguration') : t('modelProviderReady')}
                        </StatusPill>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
                      <span>{t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[activeProvider.endpointFormat])}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('modelProviderModelCount', { total: providerModelCount(activeProvider) })}</span>
                      {activeKunProviderId === activeProvider.id ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{t('modelProviderInUse')}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {!isDraftActive ? (
                      <StatusPill
                        tone={saveStatus === 'error' ? 'error' : saveStatus === 'saved' ? 'success' : 'muted'}
                        icon={saveStatus === 'saved' ? <Check className="h-3 w-3" strokeWidth={2.2} /> : undefined}
                        title={saveStatus === 'error' ? saveError : undefined}
                      >
                        {saveStatus === 'saving'
                          ? t('applying')
                          : saveStatus === 'error'
                            ? t('applyFailed')
                            : saveStatus === 'saved'
                              ? t('applied')
                              : t('autoApplyHint')}
                      </StatusPill>
                    ) : null}
                    <button
                      type="button"
                      disabled={probeBusy || activeProbeBlocked}
                      title={activeMissingCredential
                        ? t('modelProviderPresetMissingKeyForProbe')
                        : activeBaseUrlInvalid
                          ? t('modelProviderInvalidUrl')
                          : undefined}
                      onClick={() => void runProbe(activeProvider, 'test')}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink transition hover:border-accent/35 hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {probeBusy && activeProbe?.mode === 'test'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        : <PlugZap className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      {t('modelProviderTestConnection')}
                    </button>
                  </div>
                </div>
                <SettingsSubTabs<ProviderTaskTab>
                  baseId="provider-settings"
                  ariaLabel={t('modelProviderWorkspaceTabs')}
                  items={PROVIDER_TASK_TABS.map((tab) => ({
                    id: tab.id,
                    label: t(tab.labelKey)
                  }))}
                  value={activeTab}
                  onChange={setActiveTab}
                />
                {sharedConnectionsError ? (
                  <InlineNoticeView notice={{ tone: 'error', message: sharedConnectionsError }} />
                ) : null}
                {probeNotice ? <InlineNoticeView notice={probeNotice} /> : null}
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="connection"
                  active={activeTab === 'connection'}
                  className="grid gap-4"
                >
                <DetailSection title={t('modelProviderSectionBasics')}>
                  <div className="grid gap-3">
                    <label className={fieldLabelClass}>
                      {t('modelProviderName')}
                      <input
                        className={textInputClass}
                        value={activeProvider.name}
                        onChange={(e) => updateModelProvider(activeProvider.id, { name: e.target.value })}
                      />
                    </label>
                  </div>
                </DetailSection>
                <DetailSection title={t('modelProviderSectionConnection')}>
                  {isCodexProvider(activeProvider) ? (
                    <CodexLoginSection
                      provider={activeProvider}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : isGeminiSubscriptionProvider(activeProvider) ? (
                    <GeminiSubscriptionSection
                      onModelsChange={(catalog) => updateModelProvider(
                        activeProvider.id,
                        antigravityProviderCatalogPatch(catalog, activeProvider.modelProfiles)
                      )}
                      t={t}
                    />
                  ) : isGeminiCliApiSubscriptionProvider(activeProvider) ? (
                    <GeminiCliApiSubscriptionSection
                      onModelsChange={(models) => updateModelProvider(activeProvider.id, { models })}
                      t={t}
                    />
                  ) : isCursorSubscriptionProvider(activeProvider) ? (
                    <div className="grid gap-3">
                      <div className="grid gap-2 rounded-lg border border-ds-border bg-ds-main/30 px-3 py-2 text-[12px] leading-5 text-ds-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <p>{t('cursorSubscriptionNote')}</p>
                        {activeCursorApiKeyUrl ? (
                          <button
                            type="button"
                            className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 font-medium text-accent transition hover:bg-accent/10"
                            onClick={() => {
                              if (typeof window.kunGui?.openExternal !== 'function') return
                              void window.kunGui.openExternal(activeCursorApiKeyUrl).catch(() => undefined)
                            }}
                          >
                            {t('cursorSubscriptionGetApiKey')}
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
                          </button>
                        ) : null}
                      </div>
                      <label className={fieldLabelClass}>
                        {t('modelProviderApiKey')}
                        <SecretInput
                          className="min-h-11 !rounded-lg"
                          value={activeProvider.apiKey}
                          onChange={(value) => updateModelProvider(activeProvider.id, { apiKey: value })}
                          visible={showApiKey}
                          onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                          placeholder={t('modelProviderApiKeyPlaceholder')}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                        {!activeProvider.apiKey.trim() && sharedConnectionFor(activeProvider.id)?.configured ? (
                          <span className="text-[12px] font-normal text-ds-muted">
                            {zh
                              ? '凭据已安全保存在共享连接中。输入新值可替换现有凭据。'
                              : 'The credential is stored securely in the shared connection. Enter a new value to replace it.'}
                          </span>
                        ) : null}
                      </label>
                      {activeCursorAccountFresh && activeCursorAccount ? (
                        <p className="text-[12px] leading-5 text-ds-muted">
                          {t('cursorSubscriptionAccount', {
                            account: activeCursorAccount.label,
                            keyName: activeCursorAccount.apiKeyName
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : isGrokSubscriptionProvider(activeProvider) ? (
                    <GrokLoginSection
                      provider={activeProvider}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : isAgentSdkProvider(activeProvider) ? (
                    <ClaudeSubscriptionSection
                      provider={activeProvider}
                      onTokenChange={(token) => updateModelProvider(activeProvider.id, { apiKey: token })}
                      onModelsChange={(models) => updateModelProvider(activeProvider.id, { models })}
                      t={t}
                    />
                  ) : (
                    <>
                      <label className={fieldLabelClass}>
                        {t('modelProviderApiKey')}
                        <SecretInput
                          className="min-h-11 !rounded-lg"
                          value={activeProvider.apiKey}
                          onChange={(value) => updateModelProvider(activeProvider.id, { apiKey: value })}
                          visible={showApiKey}
                          onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                          placeholder={t('modelProviderApiKeyPlaceholder')}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                      </label>
                      <label className={fieldLabelClass}>
                        {t('modelProviderBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProvider(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                    </>
                  )}
                  {activeTokenPlanRegions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-ds-muted">
                        {t('modelProviderTokenPlanRegion')}
                      </span>
                      {activeTokenPlanRegions.map((region) => {
                        const active = activeProvider.baseUrl.trim() === region.baseUrl
                        return (
                          <button
                            key={region.id}
                            type="button"
                            onClick={() => {
                              const patch: Partial<ModelProviderProfileV1> = { baseUrl: region.baseUrl }
                              const speech = activeProvider.speech
                              if (speech && activeTokenPlanRegions.some((item) => item.baseUrl === speech.baseUrl.trim())) {
                                patch.speech = { ...speech, baseUrl: region.baseUrl }
                              }
                              const textToSpeech = activeProvider.textToSpeech
                              if (
                                textToSpeech &&
                                activeTokenPlanRegions.some((item) => item.baseUrl === textToSpeech.baseUrl.trim())
                              ) {
                                patch.textToSpeech = { ...textToSpeech, baseUrl: region.baseUrl }
                              }
                              updateModelProvider(activeProvider.id, patch)
                            }}
                            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition ${
                              active
                                ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
                                : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                            }`}
                          >
                            {t(`firstRunRegion_${region.id}`)}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  <label className={fieldLabelClass}>
                    {t('modelProviderEndpointFormat')}
                    <select
                      className={providerSelectControlClass}
                      value={activeProvider.endpointFormat}
                      disabled={isOAuthSubscriptionProvider(activeProvider) || isDelegatedEndpointProvider(activeProvider)}
                      onChange={(e) => updateModelProvider(activeProvider.id, {
                        endpointFormat: e.target.value as ModelEndpointFormat
                      })}
                    >
                      {MODEL_ENDPOINT_FORMATS.map((format) => (
                        <option key={format} value={format}>
                          {t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[format])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isCodexProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('codexEndpointLocked')}
                    </p>
                  ) : isGeminiSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('geminiEndpointLocked')}
                    </p>
                  ) : isGeminiCliApiSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('geminiCliApiEndpointLocked')}
                    </p>
                  ) : isCursorSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('cursorEndpointLocked')}
                    </p>
                  ) : isGrokSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('grokEndpointLocked')}
                    </p>
                  ) : isAgentSdkProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('claudeEndpointLocked')}
                    </p>
                  ) : activeProvider.endpointFormat === 'custom_endpoint' ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('modelEndpointCustomEndpointDesc')}
                    </p>
                  ) : null}
                </DetailSection>
                <SharedDefaultModelPicker
                  snapshot={sharedConnections}
                  error={sharedConnectionsError}
                  zh={zh}
                  onSelect={(connection, model) => void selectSharedModel(connection, model)}
                />
                </SettingsTabPanel>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="advanced"
                  active={activeTab === 'advanced'}
                  className="grid gap-4"
                >
                    <DetailSection title={t('modelProviderIdentitySection')}>
                      <label className={fieldLabelClass}>
                        {t('modelProviderId')}
                        <span className="relative block">
                          <input
                            className={`w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] font-normal shadow-sm ${
                              canEditActiveProviderId
                                ? 'text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
                                : 'pr-9 text-ds-faint'
                            }`}
                            value={activeProvider.id}
                            readOnly={!canEditActiveProviderId}
                            spellCheck={false}
                            onChange={(e) => updateModelProviderId(activeProvider.id, e.target.value)}
                          />
                          {!canEditActiveProviderId ? (
                            <span
                              title={t('modelProviderIdLocked')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-faint"
                            >
                              <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[12px] font-normal leading-5 text-ds-faint">
                          {t('modelProviderIdentityHint')}
                        </span>
                      </label>
                    </DetailSection>
                <DetailSection
                  title={t('modelProviderRetrySection')}
                  action={
                    <Toggle
                      ariaLabel={t('modelProviderRetrySection')}
                      checked={activeRetry.maxAttempts > 0}
                      onChange={(enabled) => updateModelProvider(activeProvider.id, {
                        retry: {
                          ...activeRetry,
                          maxAttempts: enabled ? DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS : 0
                        }
                      })}
                    />
                  }
                >
                  {activeRetry.maxAttempts > 0 ? (
                    <div className="grid gap-3">
                      <p className="text-[12px] leading-5 text-ds-faint">
                        {t('modelProviderRetryStatusCodesHint')}
                      </p>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryMaxAttempts')}
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            className={textInputClass}
                            value={activeRetry.maxAttempts}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                maxAttempts: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1)))
                              }
                            })}
                          />
                          <span className="text-[11px] font-normal leading-4 text-ds-faint">
                            {t('modelProviderRetryMaxAttemptsHint')}
                          </span>
                        </label>
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryInitialDelayMs')}
                          <input
                            type="number"
                            min={0}
                            max={600000}
                            step={100}
                            className={textInputClass}
                            value={activeRetry.initialDelayMs}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                initialDelayMs: Math.min(600_000, Math.max(0, Math.round(Number(e.target.value) || 0)))
                              }
                            })}
                          />
                        </label>
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryStatusCodes')}
                          <input
                            className={textInputClass}
                            value={retryStatusCodesText(activeRetry.httpStatusCodes)}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                httpStatusCodes: parseRetryStatusCodes(e.target.value)
                              }
                            })}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </DetailSection>
                </SettingsTabPanel>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="models"
                  active={activeTab === 'models'}
                  className="grid gap-4"
                >
                <DetailSection
                  title={`${t('modelProviderModels')} · ${providerModelCount(activeProvider)}`}
                  action={
                    <button
                      type="button"
                      disabled={probeBusy || activeProbeBlocked}
                      onClick={() => void runProbe(activeProvider, 'fetch')}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {probeBusy && activeProbe?.mode === 'fetch'
                        ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.9} />
                        : <Download className="h-3 w-3" strokeWidth={1.9} />}
                      {t('modelProviderFetchModels')}
                    </button>
                  }
                >
                  <ProviderModelsManager
                    key={activeProvider.id}
                    provider={activeProvider}
                    t={t}
                    selectControlClass={selectControlClass}
                    onChange={(next) => patchProviderProfile(activeProvider, () => next)}
                  />
                </DetailSection>
                </SettingsTabPanel>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="capabilities"
                  active={activeTab === 'capabilities'}
                  className="grid gap-3"
                >
                <CapabilitySection
                  capabilityId="image"
                  icon={<ImageIcon className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderImageCapability')}
                  description={t('modelProviderImageCapabilityDesc')}
                  enabled={Boolean(activeProvider.image)}
                  invalid={activeImageBaseUrlInvalid}
                  expanded={expandedCapabilities.has('image')}
                  modelCountLabel={activeProvider.image?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.image.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('image', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        image: presetImageCapability(activeProvider) ?? defaultImageCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('image', true)
                    } else {
                      removeModelProviderImage(activeProvider.id)
                      setCapabilityExpanded('image', false)
                    }
                  }}
                >
                  {activeProvider.image ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('imageGenProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.image.protocol}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, {
                            protocol: e.target.value as ImageGenerationProtocol
                          })}
                        >
                          {Object.entries(IMAGE_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('imageGenBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.image.baseUrl}
                          placeholder={t('imageGenBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeImageBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('imageGenModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-image`}
                          values={activeProvider.image.models}
                          onChange={(models) => updateModelProviderImage(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('imageGenModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="speech"
                  icon={<Mic className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderSpeechCapability')}
                  description={t('modelProviderSpeechCapabilityDesc')}
                  enabled={Boolean(activeProvider.speech)}
                  invalid={activeSpeechBaseUrlInvalid}
                  expanded={expandedCapabilities.has('speech')}
                  modelCountLabel={activeProvider.speech?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.speech.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  toggleDisabled={activeSpeechToggleDisabled}
                  onExpandedChange={(expanded) => setCapabilityExpanded('speech', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        speech: presetSpeechCapability(activeProvider) ?? defaultSpeechCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('speech', true)
                    } else {
                      removeModelProviderSpeech(activeProvider.id)
                      setCapabilityExpanded('speech', false)
                    }
                  }}
                >
                  {activeProvider.speech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('speechToTextProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.speech.protocol}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, {
                            protocol: e.target.value as SpeechToTextProtocol
                          })}
                        >
                          {Object.entries(SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('speechToTextBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.speech.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('speechToTextModels')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-speech`}
                          values={activeProvider.speech.models}
                          onChange={(models) => updateModelProviderSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('speechToTextModels')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="tts"
                  icon={<AudioLines className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderTextToSpeechCapability')}
                  description={t('modelProviderTextToSpeechCapabilityDesc')}
                  enabled={Boolean(activeProvider.textToSpeech)}
                  invalid={activeTextToSpeechBaseUrlInvalid}
                  expanded={expandedCapabilities.has('tts')}
                  modelCountLabel={activeProvider.textToSpeech?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.textToSpeech.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('tts', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        textToSpeech: presetTextToSpeechCapability(activeProvider) ??
                          defaultTextToSpeechCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('tts', true)
                    } else {
                      removeModelProviderTextToSpeech(activeProvider.id)
                      setCapabilityExpanded('tts', false)
                    }
                  }}
                >
                  {activeProvider.textToSpeech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('textToSpeechProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.textToSpeech.protocol}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, {
                            protocol: e.target.value as TextToSpeechProtocol
                          })}
                        >
                          {Object.entries(TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('textToSpeechBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.textToSpeech.baseUrl}
                          placeholder={t('textToSpeechBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeTextToSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('textToSpeechModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-tts`}
                          values={activeProvider.textToSpeech.models}
                          onChange={(models) => updateModelProviderTextToSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('textToSpeechModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="music"
                  icon={<Music2 className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderMusicCapability')}
                  description={t('modelProviderMusicCapabilityDesc')}
                  enabled={Boolean(activeProvider.music)}
                  invalid={activeMusicBaseUrlInvalid}
                  expanded={expandedCapabilities.has('music')}
                  modelCountLabel={activeProvider.music?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.music.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('music', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        music: presetMusicCapability(activeProvider) ?? defaultMusicCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('music', true)
                    } else {
                      removeModelProviderMusic(activeProvider.id)
                      setCapabilityExpanded('music', false)
                    }
                  }}
                >
                  {activeProvider.music ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('musicGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.music.protocol}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, {
                            protocol: e.target.value as MusicGenerationProtocol
                          })}
                        >
                          {Object.entries(MUSIC_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('musicGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.music.baseUrl}
                          placeholder={t('musicGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeMusicBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('musicGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-music`}
                          values={activeProvider.music.models}
                          onChange={(models) => updateModelProviderMusic(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('musicGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="video"
                  icon={<Clapperboard className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderVideoCapability')}
                  description={t('modelProviderVideoCapabilityDesc')}
                  enabled={Boolean(activeProvider.video)}
                  invalid={activeVideoBaseUrlInvalid}
                  expanded={expandedCapabilities.has('video')}
                  modelCountLabel={activeProvider.video?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.video.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('video', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        video: presetVideoCapability(activeProvider) ?? defaultVideoCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('video', true)
                    } else {
                      removeModelProviderVideo(activeProvider.id)
                      setCapabilityExpanded('video', false)
                    }
                  }}
                >
                  {activeProvider.video ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('videoGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.video.protocol}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, {
                            protocol: e.target.value as VideoGenerationProtocol
                          })}
                        >
                          {Object.entries(VIDEO_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('videoGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.video.baseUrl}
                          placeholder={t('videoGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeVideoBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('videoGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-video`}
                          values={activeProvider.video.models}
                          onChange={(models) => updateModelProviderVideo(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('videoGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                </SettingsTabPanel>
                {!isDraftActive && activeTab === 'advanced' && activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID ? (
                  <DetailSection title={t('modelProviderSectionDanger')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void removeModelProvider(activeProvider.id)}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-red-200/70 bg-red-50 px-3 text-[12.5px] font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t('modelProviderRemove')}
                      </button>
                      <span className="text-[12px] text-ds-faint">{t('modelProviderDangerHint')}</span>
                    </div>
                  </DetailSection>
                ) : null}
                {isDraftActive ? (
                  <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-ds-card/95 px-4 py-3 shadow-lg backdrop-blur">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-ds-ink">{t('modelProviderDraftSection')}</div>
                      <p className="mt-0.5 text-[12px] text-ds-faint">
                        {activeProvider.apiKey.trim()
                          ? t('modelProviderDraftHintReady')
                          : t('modelProviderDraftHintNoKey')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelProviderDraft}
                        className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        {t('modelProviderDraftDiscard')}
                      </button>
                      <button
                        type="button"
                        onClick={commitProviderDraft}
                        className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        {t('modelProviderDraftConfirm')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
        </SettingsTabPanel>
        <SettingsTabPanel<ProviderWorkspaceMode>
          baseId="provider-workspace"
          tabId="routes"
          active={workspaceMode === 'routes'}
          className="p-4 sm:p-6"
        >
          <ModelRoutesSettings
            settings={provider}
            onChange={(next) => update({ provider: { routePools: next.routePools, localGateway: next.localGateway } })}
            saveStatus={saveStatus}
            saveError={saveError}
            onRetrySave={retrySave}
            active={workspaceMode === 'routes'}
            publicBaseUrl={`http://127.0.0.1:${kun.port}`}
          />
        </SettingsTabPanel>
      </section>
      <details className="group rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-ds-ink">{t('modelProviderGlobalNetwork')}</h2>
              <StatusPill tone={providerProxy.enabled ? 'success' : 'muted'}>
                {providerProxy.enabled ? t('proxyEnabled') : t('modelProviderCapabilityDisabled')}
              </StatusPill>
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-ds-muted">{t('proxyUrlDesc')}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.9} />
        </summary>
        <div className="grid gap-3 border-t border-ds-border-muted px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
              <span>{t('proxyEnabled')}</span>
              <Toggle
                ariaLabel={t('proxyEnabled')}
                checked={providerProxy.enabled === true}
                onChange={(enabled) => updateProviderProxy({ enabled })}
              />
            </label>
            <input
              className={textInputClass}
              placeholder={t('proxyUrlPlaceholder')}
              value={providerProxy.url}
              spellCheck={false}
              onChange={(e) => updateProviderProxy({ url: e.target.value })}
            />
        </div>
      </details>
      {addMenuOpen ? (
        <div
          className="ds-no-drag fixed inset-0 z-50 grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-provider-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddProviderDialog()
          }}
        >
          <section
            ref={addProviderDialogRef}
            onKeyDown={handleAddProviderDialogKeyDown}
            className="flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
              <div>
                <h2 id="add-provider-dialog-title" className="text-[15px] font-semibold text-ds-ink">
                  {t('modelProviderAddDialogTitle')}
                </h2>
                <p className="mt-1 text-[12.5px] text-ds-faint">{t('modelProviderAddDialogDesc')}</p>
              </div>
              <button
                type="button"
                aria-label={t('modelProviderAddDialogCancel')}
                onClick={closeAddProviderDialog}
                className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </header>
            <div className="shrink-0 border-b border-ds-border px-5 py-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                  strokeWidth={1.9}
                />
                <input
                  autoFocus
                  value={addProviderQuery}
                  onChange={(event) => setAddProviderQuery(event.target.value)}
                  placeholder={t('modelProviderAddDialogSearch')}
                  aria-label={t('modelProviderAddDialogSearch')}
                  className="w-full rounded-xl border border-ds-border bg-ds-card py-2 pl-9 pr-3 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  closeAddProviderDialog()
                  addModelProvider()
                }}
                className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-accent/45 bg-accent/5 px-4 py-3 text-left transition hover:bg-accent/10"
              >
                <span>
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('modelProviderAddMenuCustom')}</span>
                  <span className="mt-0.5 block text-[12px] text-ds-faint">{t('modelProviderAddCustomDesc')}</span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
              </button>
              {showPlanAddGroup ? (
                <div className="mb-5 grid gap-2">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[12px] font-semibold text-ds-muted">{t('modelProviderGroupPlans')}</h3>
                      <span className="text-[11px] text-ds-faint">{planAddEntries.length}</span>
                    </div>
                    <div
                      role="tablist"
                      aria-label={t('modelProviderSubscriptionRegions')}
                      className="inline-flex items-center rounded-lg border border-ds-border-muted bg-ds-main/70 p-0.5"
                    >
                      {SUBSCRIPTION_REGION_TABS.map((tab) => {
                        const selected = subscriptionRegion === tab.id
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => setSubscriptionRegion(tab.id)}
                            onKeyDown={(event) => handleSubscriptionRegionTabKeyDown(event, tab.id)}
                            className={`min-w-12 rounded-md border px-2.5 py-1 text-[11.5px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                              selected
                                ? 'border-accent/25 bg-accent/10 text-accent shadow-sm'
                                : 'border-transparent text-ds-faint hover:bg-ds-card hover:text-ds-muted'
                            }`}
                          >
                            {t(tab.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {planAddEntries.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">{planAddEntries.map(renderAddEntry)}</div>
                  ) : null}
                </div>
              ) : null}
              {apiAddEntries.length > 0 ? (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <h3 className="text-[12px] font-semibold text-ds-muted">{t('modelProviderGroupApi')}</h3>
                    <span className="text-[11px] text-ds-faint">{apiAddEntries.length}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">{apiAddEntries.map(renderAddEntry)}</div>
                </div>
              ) : null}
              {planAddEntries.length === 0 && apiAddEntries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ds-border-muted px-4 py-8 text-center text-[12.5px] text-ds-faint">
                  {t('modelProviderAddDialogEmpty', { query: addProviderQuery.trim() })}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {pendingImport && pendingImportProvider ? (
      <ProviderModelImportDialog
        provider={pendingImportProvider}
        providerModelIds={pendingImport.providerModelIds}
        catalogResult={pendingImport.catalogResult}
        providerError={pendingImport.providerError}
        authoritative={pendingImport.authoritative}
        t={t}
        onCancel={() => setPendingImport(null)}
        onConfirm={(picked) => {
          importPickedModels(
            pendingImportProvider,
            picked,
            pendingImport.authoritative,
            pendingImport.modelAliases,
            pendingImport.discoveredModelProfiles
          )
          setPendingImport(null)
        }}
      />
    ) : null}
    </>
  )
}
