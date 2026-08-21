import type {
  ModelEndpointFormat,
  ModelProviderModelProfileV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1
} from '@shared/app-settings'
import {
  modelProviderRequiresApiKey,
  modelSupportsImageInput
} from '@shared/app-settings-provider-core'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Search
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import { StatusPill } from './settings-section-providers-controls'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'


export type SharedModelConnection = {
  id: string
  accountId: string
  name: string
  presetSource?: string
  presetMode?: 'api' | 'token-plan'
  kind: 'http' | 'agent-sdk' | 'antigravity-cli' | 'cursor-sdk' | 'gemini-code-assist' | 'gemini-cli-api'
  authType: 'api-key' | 'oauth' | 'subscription'
  baseUrl?: string
  endpointFormat: ModelEndpointFormat
  configured: boolean
  credentialStatus?: 'ready' | 'missing' | 'unreadable'
  credentialErrorCode?: 'credential_missing' | 'credential_unreadable'
  models: string[]
  modelCapabilities?: Record<string, Omit<ModelProviderModelProfileV1, 'aliases'> & { id: string }>
  selectedModel?: string
}

export type SharedModelConnectionsSnapshot = {
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

export const MAX_SHARED_MODEL_CONNECTION_MODELS = 500

export function shouldUseSharedModelConnectionProbe(
  provider: Pick<ModelProviderProfileV1, 'apiKey'>,
  connection: Pick<SharedModelConnection, 'configured' | 'credentialStatus'> | undefined
): boolean {
  return !provider.apiKey.trim() && sharedModelConnectionHasUsableCredential(connection)
}

export type ProjectedKunSelectionPatch = {
  providerId: string
  model?: string
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
      connection.id === provider.id && sharedModelConnectionHasUsableCredential(connection)
    )
  )
}

export function validateSharedModelConnections(value: unknown): SharedModelConnectionsSnapshot {
  const snapshot = value as SharedModelConnectionsSnapshot
  if (snapshot?.schemaVersion !== 1 || !Number.isInteger(snapshot.revision) || !Array.isArray(snapshot.providers)) {
    throw new Error('Invalid shared model connection response')
  }
  return snapshot
}

export function parseSharedModelConnections(body: string): SharedModelConnectionsSnapshot {
  const value = JSON.parse(body) as unknown
  return validateSharedModelConnections(value)
}

export function parseSharedModelConnectionEvent(body: string): SharedModelConnectionsSnapshot {
  const value = JSON.parse(body) as { snapshot?: unknown }
  return validateSharedModelConnections(value?.snapshot)
}

export function SharedDefaultModelPicker({
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
  const [placement, setPlacement] = useState<'down' | 'up'>('down')
  const [activeProviderId, setActiveProviderId] = useState('')
  const [query, setQuery] = useState('')
  const providers = useMemo(() => snapshot?.providers ?? [], [snapshot?.providers])
  const defaultProvider = providers.find((connection) =>
    connection.id === snapshot?.defaultProviderId
  )
  const activeProvider = providers.find((connection) => connection.id === activeProviderId) ??
    defaultProvider ??
    providers.find((connection) =>
      sharedModelConnectionHasUsableCredential(connection) && connection.models.length > 0
    ) ??
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
          providers.find((connection) =>
            sharedModelConnectionHasUsableCredential(connection) && connection.models.length > 0
          )?.id ??
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
            if (!open) {
              // 该区块靠近页面底部,下方空间不足时向上展开,避免弹层被视口裁切
              const rect = triggerRef.current?.getBoundingClientRect()
              if (rect) {
                const spaceBelow = window.innerHeight - rect.bottom
                const spaceAbove = rect.top
                const panelHeight = Math.min(420, window.innerHeight * 0.7)
                setPlacement(
                  spaceBelow < panelHeight && spaceAbove > spaceBelow ? 'up' : 'down'
                )
              }
            }
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
            className={`absolute left-0 z-40 grid max-h-[70vh] w-full min-w-0 grid-cols-1 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl shadow-black/10 sm:grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.2fr)] dark:shadow-black/35 ${
              placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >
            <div className="min-w-0 border-b border-ds-border-muted p-2 sm:border-b-0 sm:border-r">
              <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-ds-faint">
                {zh ? '供应商' : 'Provider'}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {providers.map((connection) => {
                  const active = connection.id === activeProvider?.id
                  const available = sharedModelConnectionHasUsableCredential(connection) &&
                    connection.models.length > 0
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
                {!sharedModelConnectionHasUsableCredential(activeProvider) ? (
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

export class SharedModelConnectionConflictError extends Error {
  constructor(readonly snapshot: SharedModelConnectionsSnapshot) {
    super('The shared model configuration changed in another client.')
    this.name = 'SharedModelConnectionConflictError'
  }
}

export async function requestSharedModelConnections(
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

export async function requestSharedModelConnectionProbe(providerId: string): Promise<string[]> {
  const result = await window.kunGui.runtimeRequest(
    `/v1/model-connections/${encodeURIComponent(providerId)}/probe`,
    'POST'
  )
  if (!result.ok) {
    let message = ''
    try {
      const value = JSON.parse(result.body) as { message?: unknown }
      if (typeof value.message === 'string') message = value.message.trim()
    } catch {
      // Keep the HTTP fallback below.
    }
    throw new Error(message || `Shared model connection probe failed (HTTP ${result.status})`)
  }
  const value = JSON.parse(result.body) as { ok?: unknown; models?: unknown }
  if (value.ok !== true || !Array.isArray(value.models)) {
    throw new Error('Shared model connection probe returned an invalid response')
  }
  return value.models.flatMap((model) => typeof model === 'string' && model.trim() ? [model.trim()] : [])
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
    if (!sharedModelConnectionHasUsableCredential(connection)) {
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
