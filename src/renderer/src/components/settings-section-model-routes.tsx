import type { ModelProviderSettingsV1, ModelRoutePoolV1, ModelRouteStrategy } from '@shared/app-settings'
import {
  DEFAULT_MODEL_ROUTE_FAILURE_POLICY,
  DEFAULT_MODEL_ROUTE_HEALTH_POLICY,
  projectExecutableModelRoutePools,
  resolveModelRouteTargetReference
} from '@shared/app-settings-provider-core'
import { KUN_MODEL_ROUTES_PATH, kunModelRouteTestPath } from '@shared/kun-endpoints'
import type { GatewayCredentialStatus, KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import type { TFunction } from 'i18next'
import { Activity, AlertTriangle, Boxes, Check, ChevronDown, Clipboard, Code2, Loader2, Play, Plus, Route, Server, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsSubTabs, SettingsTabPanel, Toggle } from './settings-controls'
import {
  ApiCompatibilityPill,
  Field,
  LocalGatewayApiDialog,
  ToggleRow,
  attemptStatusLabel,
  buildGatewayCurlExample,
  chainTestBlockedReason,
  compactInputClass,
  formatTarget,
  inputClass,
  parseCodes,
  routeStatusError,
  runtimeConfigurationMatches,
  runtimePoolMatches,
  testProgress,
  testStatusClass,
  testStatusLabel,
  uniqueValue,
  useValidatedTextDraft,
  validCodes
} from './settings-section-model-routes-support'
import { ModelRouteTargets } from './settings-section-model-routes-targets'
import { useGatewayCredentialControls } from './use-gateway-credential-controls'

export type RouteStatus = {
  localGateway?: { enabled: boolean; credential?: GatewayCredentialStatus }
  pools?: ModelRoutePoolV1[]
  configuredPools?: ModelRoutePoolV1[]
  metrics?: Record<string, { successes: number; failures: number; ewmaLatencyMs?: number; lastError?: string }>
  events?: Array<{ at: string; poolId: string; targetId: string; providerId: string; modelId: string; result: string; latencyMs: number; testId?: string; category?: string; message?: string }>
  tests?: RoutePoolTestRecord[]
}

export type RoutePoolTestAttempt = {
  index: number
  targetId: string
  providerId: string
  modelId: string
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  completedAt?: string
  latencyMs?: number
  category?: string
  message?: string
}

export type RoutePoolTestRecord = {
  id: string
  poolId: string
  modelId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  createdAt: string
  startedAt?: string
  completedAt?: string
  totalTargets: number
  attemptedTargets: number
  attempts: RoutePoolTestAttempt[]
  currentTarget?: RouteTestTarget
  selectedTarget?: RouteTestTarget
  output?: string
  error?: { message: string; code?: string; category?: string }
}

export type RouteTestTarget = { targetId: string; providerId: string; modelId: string }
type ModelRouteSettingsTab = 'gateway' | 'models' | 'resilience' | 'monitoring'

const strategyTranslationKeys: Record<ModelRouteStrategy, string> = {
  priority: 'modelRoutes.strategyPriority',
  'round-robin': 'modelRoutes.strategyRoundRobin',
  'weighted-round-robin': 'modelRoutes.strategyWeightedRoundRobin',
  'least-latency': 'modelRoutes.strategyLeastLatency',
  adaptive: 'modelRoutes.strategyAdaptive'
}

function EmptyRoutePoolState({ onAdd, t }: { onAdd: () => void; t: TFunction }): ReactElement {
  return (
    <div className="grid min-h-[360px] place-items-center text-center">
      <div>
        <Route className="mx-auto h-10 w-10 text-ds-faint" />
        <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">{t('modelRoutes.emptyTitle')}</h3>
        <p className="mt-1 text-[12px] text-ds-faint">{t('modelRoutes.gatewayMultipleModelsDesc')}</p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12px] font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('modelRoutes.addModel')}
        </button>
      </div>
    </div>
  )
}

export function ModelRoutesSettings({
  settings,
  onChange,
  translation,
  saveStatus = 'idle',
  saveError,
  onRetrySave,
  active = true,
  publicBaseUrl = 'http://127.0.0.1:18899'
}: {
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  translation?: TFunction
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  saveError?: string | null
  onRetrySave?: () => void
  active?: boolean
  /** The configured local Kun endpoint; this is also the public gateway origin. */
  publicBaseUrl?: string
}): ReactElement {
  const { t: localTranslation, i18n } = useTranslation('settings')
  const t = translation ?? localTranslation
  const [selectedId, setSelectedId] = useState(settings.routePools[0]?.id ?? '')
  const [status, setStatus] = useState<RouteStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [runtimeSyncStatus, setRuntimeSyncStatus] = useState<KunRuntimeSettingsSyncStatusPayload | null>(null)
  const [startPending, setStartPending] = useState(false)
  const [startError, setStartError] = useState('')
  const [apiDocsOpen, setApiDocsOpen] = useState(false)
  const [copiedValue, setCopiedValue] = useState<'base-url' | 'curl' | 'api-example' | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState<ModelRouteSettingsTab>('gateway')
  const gatewayCredential = useGatewayCredentialControls(settings, onChange, setStartError)
  const credential = gatewayCredential.credential
  const credentialPending = gatewayCredential.pending
  const selected = settings.routePools.find((pool) => pool.id === selectedId) ?? settings.routePools[0]
  const executablePools = useMemo(() => projectExecutableModelRoutePools(settings), [settings])
  const executableSelected = executablePools.find((pool) => pool.id === selected?.id)
  const configurationSynced = useMemo(
    () => runtimeConfigurationMatches(executablePools, settings.localGateway.enabled, status),
    [executablePools, settings.localGateway.enabled, status]
  )
  useEffect(() => {
    if (!selected && settings.routePools[0]) setSelectedId(settings.routePools[0].id)
  }, [selected, settings.routePools])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await window.kunGui.runtimeRequest(KUN_MODEL_ROUTES_PATH, 'GET')
      if (!response.ok) throw new Error(routeStatusError(response.body, response.status, t))
      const next = JSON.parse(response.body) as RouteStatus
      setStatus(next)
      setStatusError('')
    } catch (error) {
      // Local settings remain durable while Runtime is stopped or unavailable.
      setStatus(null)
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }, [t])
  useEffect(() => {
    if (!active) return
    void refreshStatus()
    const interval = globalThis.setInterval(() => { void refreshStatus() }, 1_000)
    return () => globalThis.clearInterval(interval)
  }, [active, refreshStatus])
  useEffect(() => {
    if (!active) return
    let mounted = true
    if (typeof window.kunGui.getRuntimeSettingsSyncStatus === 'function') {
      void window.kunGui.getRuntimeSettingsSyncStatus()
        .then((next) => {
          if (mounted) {
            setRuntimeSyncStatus((current) =>
              current && current.generation > next.generation ? current : next
            )
          }
        })
        .catch(() => undefined)
    }
    const unsubscribe = typeof window.kunGui.onRuntimeSettingsSyncStatus === 'function'
      ? window.kunGui.onRuntimeSettingsSyncStatus((next) => {
          if (mounted) {
            setRuntimeSyncStatus((current) =>
              current && current.generation > next.generation ? current : next
            )
          }
        })
      : undefined
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [active])
  useEffect(() => { setStartError('') }, [selected?.id])

  const updatePool = (patch: Partial<ModelRoutePoolV1>): void => {
    if (!selected) return
    onChange({ ...settings, routePools: settings.routePools.map((pool) => pool.id === selected.id ? { ...pool, ...patch } : pool) })
  }
  const modelIdDraft = useValidatedTextDraft({
    scopeId: selected?.id ?? '',
    value: selected?.modelId ?? '',
    validate: (value) => {
      if (!value) return t('modelRoutes.publicModelIdRequired')
      const duplicate = settings.routePools.some((pool) => pool.id !== selected?.id && pool.modelId.trim().toLowerCase() === value.toLowerCase())
      return duplicate ? t('modelRoutes.publicModelIdDuplicate', { modelId: value }) : undefined
    },
    onCommit: (modelId) => updatePool({ modelId })
  })
  const failoverCodesDraft = useValidatedTextDraft({
    scopeId: selected?.id ?? '',
    value: selected?.failurePolicy.failoverHttpStatusCodes.join(', ') ?? '',
    validate: (value) => validCodes(value) ? undefined : t('modelRoutes.failoverStatusesInvalid'),
    onCommit: (value) => updatePool({
      failurePolicy: { ...selected!.failurePolicy, failoverHttpStatusCodes: parseCodes(value) }
    })
  })

  const addPool = (): void => {
    const provider = settings.providers.find((candidate) => candidate.models.length > 0)
    const ordinal = settings.routePools.length + 1
    const id = uniqueValue(`route-pool-${ordinal}`, new Set(settings.routePools.map((pool) => pool.id)))
    const modelId = uniqueValue(`local-route-${ordinal}`, new Set([
      ...settings.providers.flatMap((item) => item.models),
      ...settings.routePools.map((pool) => pool.modelId)
    ]))
    const pool: ModelRoutePoolV1 = {
      id,
      name: t('modelRoutes.defaultRouteName', { index: ordinal }),
      modelId,
      enabled: false,
      strategy: 'priority',
      targets: provider ? [{ id: `${id}-target-1`, providerId: provider.id, modelId: provider.models[0], enabled: true, weight: 1 }] : [],
      failurePolicy: { ...DEFAULT_MODEL_ROUTE_FAILURE_POLICY, failoverHttpStatusCodes: [...DEFAULT_MODEL_ROUTE_FAILURE_POLICY.failoverHttpStatusCodes] },
      healthPolicy: { ...DEFAULT_MODEL_ROUTE_HEALTH_POLICY }
    }
    onChange({ ...settings, routePools: [...settings.routePools, pool] })
    setSelectedId(id)
  }

  const removePool = (): void => {
    if (!selected) return
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(t('modelRoutes.confirmDeleteModel', { modelId: selected.modelId }))) return
    const next = settings.routePools.filter((pool) => pool.id !== selected.id)
    onChange({ ...settings, routePools: next })
    setSelectedId(next[0]?.id ?? '')
  }

  const runTest = async (): Promise<void> => {
    if (!selected || !runtimeReady) return
    setStartPending(true)
    setStartError('')
    try {
      const response = await window.kunGui.runtimeRequest(kunModelRouteTestPath(selected.id), 'POST')
      const body = JSON.parse(response.body) as { test?: RoutePoolTestRecord; error?: { message?: string } }
      if (!response.ok || !body.test) throw new Error(body.error?.message ?? t('modelRoutes.testCreateFailed'))
      setStatus((current) => ({
        ...(current ?? {}),
        tests: [body.test!, ...(current?.tests ?? []).filter((test) => test.id !== body.test!.id)]
      }))
      await refreshStatus()
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
    } finally {
      setStartPending(false)
    }
  }

  const events = useMemo(() => (status?.events ?? []).filter((event) => !selected || event.poolId === selected.id).slice(-8).reverse(), [selected, status?.events])
  const selectedTests = useMemo(() => (status?.tests ?? []).filter((test) => test.poolId === selected?.id), [selected?.id, status?.tests])
  const latestTest = selectedTests[0]
  const activeTest = latestTest?.status === 'queued' || latestTest?.status === 'running'
  const runtimePool = (status?.configuredPools ?? status?.pools)?.find((pool) => pool.id === selected?.id)
  const selectedHasExecutableTarget = Boolean(executableSelected?.enabled && executableSelected.targets.some((target) => target.enabled))
  const persistenceReady = saveStatus !== 'saving' && saveStatus !== 'error'
  const runtimeReady = Boolean(
    selected?.enabled &&
    selectedHasExecutableTarget &&
    persistenceReady &&
    configurationSynced &&
    runtimePoolMatches(executableSelected, runtimePool)
  )
  const invalidTargetCount = selected?.targets.filter((target) =>
    resolveModelRouteTargetReference(target, settings.providers).status !== 'valid'
  ).length ?? 0
  const strategies = (Object.keys(strategyTranslationKeys) as ModelRouteStrategy[]).map((id) => ({
    id,
    label: t(strategyTranslationKeys[id])
  }))
  const testButtonLabel = startPending
    ? t('modelRoutes.testButtonCreating')
    : activeTest
      ? t('modelRoutes.testButtonInProgress')
      : saveStatus === 'error'
        ? t('modelRoutes.testButtonFixSave')
        : saveStatus === 'saving'
          ? t('modelRoutes.testButtonWaitSave')
          : !selected?.enabled
        ? t('modelRoutes.testButtonEnableFirst')
        : !selectedHasExecutableTarget
          ? t('modelRoutes.testButtonFixInvalidTargets')
        : !status
          ? t('modelRoutes.runtimeUnavailable')
          : !runtimeReady
            ? t('modelRoutes.testButtonWaitSync')
            : t('modelRoutes.testButtonRun')

  const localSaveLabel = saveStatus === 'saving'
    ? t('modelRoutes.localSaveSaving')
    : saveStatus === 'error'
      ? t('modelRoutes.localSaveFailed')
      : t('modelRoutes.localSaveComplete')
  const runtimeSyncFailed = Boolean(
    !configurationSynced && runtimeSyncStatus?.state === 'failed'
  )
  const runtimeSyncLabel = configurationSynced
    ? t('modelRoutes.runtimeSynced')
    : runtimeSyncFailed
        ? t('modelRoutes.runtimeSyncFailed')
        : !status
          ? runtimeSyncStatus?.state === 'unavailable' ? t('modelRoutes.runtimeNotRunning') : t('modelRoutes.runtimeNotConnected')
              : runtimeSyncStatus?.state === 'syncing'
              ? t('modelRoutes.runtimeSyncing')
              : t('modelRoutes.runtimeWaitingForSync')
  const gatewayBaseUrl = `${publicBaseUrl.replace(/\/$/, '')}/v1`
  const sampleModelId = executablePools.find((pool) => pool.enabled && pool.targets.some((target) => target.enabled))?.modelId
  const apiExampleModelId = sampleModelId || 'your-public-model-id'
  const curlExample = buildGatewayCurlExample(gatewayBaseUrl, apiExampleModelId, t)
  const copyGatewayText = async (value: string, kind: 'base-url' | 'curl' | 'api-example'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(kind)
      globalThis.setTimeout(() => setCopiedValue((current) => current === kind ? null : current), 1_800)
    } catch {
      setCopiedValue(null)
    }
  }

  return (
    <div className="grid content-start auto-rows-min gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="lg:col-span-2">
        <SettingsSubTabs<ModelRouteSettingsTab>
          baseId="model-routes-settings"
          ariaLabel={t('modelRoutes.tabsAria')}
          items={[
            { id: 'gateway', label: t('modelRoutes.tabGateway'), icon: Server },
            { id: 'models', label: t('modelRoutes.tabModels'), icon: Boxes },
            { id: 'resilience', label: t('modelRoutes.tabResilience'), icon: AlertTriangle },
            { id: 'monitoring', label: t('modelRoutes.tabMonitoring'), icon: Activity }
          ]}
          value={activeSettingsTab}
          onChange={setActiveSettingsTab}
        />
      </div>

      <SettingsTabPanel
        baseId="model-routes-settings"
        tabId="gateway"
        active={activeSettingsTab === 'gateway'}
        className="lg:col-span-2"
      >
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-ds-border bg-ds-main/35 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
          <Server className="h-5 w-5" />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-ds-faint">{t('modelRoutes.localRelayProvider')}</span>
            <span className="rounded-full bg-ds-card px-2 py-0.5 text-[10.5px] text-ds-muted">
              {t('modelRoutes.enabledModelCount', {
                enabled: settings.routePools.filter((pool) => pool.enabled).length,
                total: settings.routePools.length
              })}
            </span>
          </div>
          <input
            value={settings.localGateway.name}
            onChange={(event) => onChange({
              ...settings,
              localGateway: { ...settings.localGateway, name: event.target.value }
            })}
            aria-label={t('modelRoutes.providerNameAria')}
            className="mt-1 w-full max-w-md bg-transparent text-[17px] font-semibold text-ds-ink outline-none"
          />
          <p className="mt-1 text-[11.5px] text-ds-faint">{t('modelRoutes.providerDesc')}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5">
          <div>
            <div className="text-[12px] font-medium text-ds-ink">{t('modelRoutes.enableLocalApi')}</div>
            <div className="mt-0.5 text-[10.5px] text-ds-faint">Bearer key required; loopback only</div>
          </div>
          <Toggle
            checked={settings.localGateway.enabled}
            disabled={credentialPending}
            onChange={(enabled) => { void gatewayCredential.setEnabled(enabled) }}
            ariaLabel={t('modelRoutes.enableLocalApi')}
          />
        </div>
        <div className="flex basis-full flex-wrap items-center gap-2 border-t border-ds-border-muted pt-3">
          <span className={credential.configured ? 'text-[11px] font-medium text-emerald-700' : 'text-[11px] font-medium text-amber-700'}>
            API key: {credential.configured ? 'configured' : 'not configured'}
          </span>
          <button type="button" disabled={credentialPending} onClick={() => void gatewayCredential.update('ensure')} className="rounded-full border border-ds-border px-2.5 py-1 text-[11px]">Create</button>
          <button type="button" disabled={credentialPending || !credential.configured} onClick={() => void gatewayCredential.update('copy')} className="rounded-full border border-ds-border px-2.5 py-1 text-[11px]">Copy</button>
          <button type="button" disabled={credentialPending} onClick={() => void gatewayCredential.update('rotate')} className="rounded-full border border-ds-border px-2.5 py-1 text-[11px]">Rotate</button>
          <button type="button" disabled={credentialPending || !credential.configured} onClick={() => void gatewayCredential.update('revoke')} className="rounded-full border border-red-200 px-2.5 py-1 text-[11px] text-red-700">Revoke</button>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            saveStatus === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
              : saveStatus === 'saving'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
          }`}>{localSaveLabel}</span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            configurationSynced
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
              : runtimeSyncFailed
                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
              : status
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                : 'bg-ds-card text-ds-muted'
          }`}>{runtimeSyncLabel}</span>
          {saveStatus === 'error' && onRetrySave ? (
            <button type="button" onClick={onRetrySave} className="rounded-full border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-700">
              {t('modelRoutes.retrySave')}
            </button>
          ) : null}
          {saveStatus === 'error' && saveError ? <span className="min-w-0 truncate text-[11px] text-red-600" title={saveError}>{saveError}</span> : null}
          {!status && statusError ? <span className="min-w-0 truncate text-[11px] text-ds-faint" title={statusError}>{t('modelRoutes.runtimeUnavailableHint')}</span> : null}
          {runtimeSyncFailed && runtimeSyncStatus?.message ? <span className="min-w-0 truncate text-[11px] text-red-600" title={runtimeSyncStatus.message}>{runtimeSyncStatus.message}</span> : null}
        </div>

        <section className="grid basis-full gap-3 rounded-xl border border-ds-border bg-ds-card p-3.5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ds-ink"><Code2 className="h-4 w-4 text-accent" />{t('modelRoutes.localApi')}</h3>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${settings.localGateway.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-ds-main text-ds-muted'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${settings.localGateway.enabled ? 'bg-emerald-500' : 'bg-ds-faint'}`} />
                {settings.localGateway.enabled ? t('modelRoutes.localApiEnabledLocalOnly') : t('modelRoutes.disabled')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ds-faint">{t('modelRoutes.apiCompatibilityDesc')}</p>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-main px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ds-ink" title={gatewayBaseUrl}>{gatewayBaseUrl}</span>
              <button type="button" onClick={() => void copyGatewayText(gatewayBaseUrl, 'base-url')} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-label={t('modelRoutes.copyLocalApiAddress')}>
                {copiedValue === 'base-url' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Clipboard className="h-3.5 w-3.5" />}
                {copiedValue === 'base-url' ? t('modelRoutes.copied') : t('modelRoutes.copy')}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-ds-muted">
              <ApiCompatibilityPill>GET /models</ApiCompatibilityPill>
              <ApiCompatibilityPill>POST /chat/completions</ApiCompatibilityPill>
              <ApiCompatibilityPill>POST /responses</ApiCompatibilityPill>
            </div>
          </div>
          <div className="flex items-end gap-2 lg:flex-col lg:items-stretch lg:justify-center">
            <button type="button" disabled={!sampleModelId} title={!sampleModelId ? t('modelRoutes.copyCurlUnavailable') : undefined} onClick={() => void copyGatewayText(curlExample, 'curl')} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">
              {copiedValue === 'curl' ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copiedValue === 'curl' ? t('modelRoutes.copied') : t('modelRoutes.copyCurl')}
            </button>
            <button type="button" onClick={() => setApiDocsOpen((open) => !open)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-ds-border px-3 text-[11.5px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-expanded={apiDocsOpen}>
              {t('modelRoutes.apiDocs')} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${apiDocsOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

        </section>
        {apiDocsOpen ? <LocalGatewayApiDialog
          baseUrl={gatewayBaseUrl}
          modelId={apiExampleModelId}
          copied={copiedValue === 'api-example'}
          onClose={() => setApiDocsOpen(false)}
          onCopy={(value) => void copyGatewayText(value, 'api-example')}
        /> : null}
        </section>
      </SettingsTabPanel>
      <aside className={`${activeSettingsTab === 'gateway' ? 'hidden' : 'grid'} min-w-0 content-start gap-3 border-b border-ds-border-muted pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink"><Boxes className="h-4 w-4 text-accent" />{t('modelRoutes.routedModels')}</h3>
            <p className="mt-1 text-[12px] leading-5 text-ds-faint">{t('modelRoutes.choosePool')}</p>
          </div>
        </div>
        <button type="button" onClick={addPool} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-accent text-[12.5px] font-semibold text-white">
          <Plus className="h-4 w-4" /> {t('modelRoutes.addModel')}
        </button>
        <div className="grid gap-2">
          {settings.routePools.map((pool) => {
            const executablePool = executablePools.find((candidate) => candidate.id === pool.id)
            const available = executablePool?.targets.filter((target) => target.enabled).length ?? 0
            const invalid = pool.targets.length - (executablePool?.targets.length ?? 0)
            return (
              <button key={pool.id} type="button" onClick={() => setSelectedId(pool.id)} className={`rounded-xl border px-3 py-3 text-left transition ${selected?.id === pool.id ? 'border-accent bg-accent/5' : 'border-ds-border bg-ds-card hover:bg-ds-hover'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[13px] font-semibold text-ds-ink">{pool.modelId}</span>
                  <span className={`h-2 w-2 rounded-full ${executablePool?.enabled ? 'bg-emerald-500' : invalid > 0 ? 'bg-amber-500' : 'bg-ds-faint'}`} />
                </div>
                <div className="mt-1 truncate text-[11px] text-ds-faint">{pool.name}</div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-ds-muted"><span>{t('modelRoutes.availableTargets', { available, total: pool.targets.length })}{invalid > 0 ? ` · ${t('modelRoutes.invalidTargets', { count: invalid })}` : ''}</span><span>{strategies.find((item) => item.id === pool.strategy)?.label}</span></div>
              </button>
            )
          })}
          {settings.routePools.length === 0 ? <div className="rounded-xl border border-dashed border-ds-border px-3 py-8 text-center text-[12px] text-ds-faint">{t('modelRoutes.noModels')}</div> : null}
        </div>
      </aside>

      <main className={activeSettingsTab === 'gateway' ? 'hidden' : 'min-w-0'}>
        <SettingsTabPanel
          baseId="model-routes-settings"
          tabId="models"
          active={activeSettingsTab === 'models'}
          className="grid content-start gap-5"
        >
          {selected ? (
            <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-medium text-accent">{settings.localGateway.name} / {t('modelRoutes.routedModel')}</p>
              <input aria-label={t('modelRoutes.routeModelNameAria')} value={selected.name} onChange={(event) => updatePool({ name: event.target.value })} className="w-full bg-transparent text-[20px] font-semibold text-ds-ink outline-none" />
              <p className="mt-1 text-[12px] text-ds-faint">{t('modelRoutes.hotUpdateHint')}</p>
            </div>
            <div className="flex items-center gap-3"><span className="text-[12px] text-ds-muted">{t('modelRoutes.enable')}</span><Toggle checked={selected.enabled} onChange={(enabled) => updatePool({ enabled })} ariaLabel={t('modelRoutes.enablePoolAria')} /></div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div><Field label={t('modelRoutes.publicModelId')}><input aria-label={t('modelRoutes.publicModelId')} value={modelIdDraft.draft} onChange={(event) => modelIdDraft.onChange(event.target.value)} onFocus={modelIdDraft.onFocus} onBlur={modelIdDraft.onBlur} onKeyDown={modelIdDraft.onKeyDown} className={inputClass} spellCheck={false} /></Field>{modelIdDraft.error ? <p className="mt-1 text-[11px] text-red-600">{modelIdDraft.error}</p> : null}</div>
            <Field label={t('modelRoutes.loadStrategy')}><select value={selected.strategy} onChange={(event) => updatePool({ strategy: event.target.value as ModelRouteStrategy })} className={inputClass}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}</select></Field>
          </div>

          <ModelRouteTargets settings={settings} pool={selected} metrics={status?.metrics} onUpdate={updatePool} t={t} />

              <div className="flex justify-end">
                <button type="button" onClick={removePool} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-2 text-[12px] text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('modelRoutes.deleteModel')}
                </button>
              </div>
            </>
          ) : (
            <EmptyRoutePoolState onAdd={addPool} t={t} />
          )}
        </SettingsTabPanel>

        <SettingsTabPanel
          baseId="model-routes-settings"
          tabId="resilience"
          active={activeSettingsTab === 'resilience'}
          className="grid content-start gap-5"
        >
          {selected ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <section className="rounded-xl border border-ds-border p-4">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink"><AlertTriangle className="h-4 w-4 text-amber-500" />{t('modelRoutes.failoverRules')}</h3>
                <div className="mt-3 grid gap-3 text-[12px] text-ds-muted">
                  <ToggleRow label={t('modelRoutes.networkError')} checked={selected.failurePolicy.failoverOnNetworkError} onChange={(value) => updatePool({ failurePolicy: { ...selected.failurePolicy, failoverOnNetworkError: value } })} />
                  <ToggleRow label={t('modelRoutes.requestTimeout')} checked={selected.failurePolicy.failoverOnTimeout} onChange={(value) => updatePool({ failurePolicy: { ...selected.failurePolicy, failoverOnTimeout: value } })} />
                  <ToggleRow label={t('modelRoutes.credentialError')} checked={selected.failurePolicy.failoverOnAuthError} onChange={(value) => updatePool({ failurePolicy: { ...selected.failurePolicy, failoverOnAuthError: value } })} />
                  <div><Field label={t('modelRoutes.failoverStatuses')}><input aria-label={t('modelRoutes.failoverStatuses')} value={failoverCodesDraft.draft} onChange={(event) => failoverCodesDraft.onChange(event.target.value)} onFocus={failoverCodesDraft.onFocus} onBlur={failoverCodesDraft.onBlur} onKeyDown={failoverCodesDraft.onKeyDown} className={compactInputClass} /></Field>{failoverCodesDraft.error ? <p className="mt-1 text-[11px] text-red-600">{failoverCodesDraft.error}</p> : null}</div>
                  <p className="text-[11px] text-ds-faint">{t('modelRoutes.afterStreamNoRetry')}</p>
                </div>
              </section>
              <section className="rounded-xl border border-ds-border p-4">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink"><Activity className="h-4 w-4 text-emerald-500" />{t('modelRoutes.healthCircuit')}</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label={t('modelRoutes.consecutiveFailures')}><input type="number" min={1} max={20} value={selected.healthPolicy.failureThreshold} onChange={(event) => updatePool({ healthPolicy: { ...selected.healthPolicy, failureThreshold: Number(event.target.value) } })} className={compactInputClass} /></Field>
                  <Field label={t('modelRoutes.cooldownSeconds')}><input type="number" min={1} value={Math.round(selected.healthPolicy.cooldownMs / 1000)} onChange={(event) => updatePool({ healthPolicy: { ...selected.healthPolicy, cooldownMs: Number(event.target.value) * 1000 } })} className={compactInputClass} /></Field>
                  <Field label={t('modelRoutes.halfOpenProbes')}><input type="number" min={1} max={10} value={selected.healthPolicy.halfOpenMaxAttempts} onChange={(event) => updatePool({ healthPolicy: { ...selected.healthPolicy, halfOpenMaxAttempts: Number(event.target.value) } })} className={compactInputClass} /></Field>
                </div>
              </section>
            </div>
          ) : (
            <EmptyRoutePoolState onAdd={addPool} t={t} />
          )}
        </SettingsTabPanel>

        <SettingsTabPanel
          baseId="model-routes-settings"
          tabId="monitoring"
          active={activeSettingsTab === 'monitoring'}
          className="grid content-start gap-5"
        >
          {selected ? (
            <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold text-ds-ink">{t('modelRoutes.routeValidation')}</h3>
                <p className="mt-1 text-[11px] text-ds-faint">{t('modelRoutes.routeValidationDesc')}</p>
              </div>
              <button
                type="button"
                disabled={startPending || activeTest || !runtimeReady}
                onClick={() => void runTest()}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-accent px-4 text-[12px] font-medium text-accent disabled:opacity-40"
              >
                {startPending || activeTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {testButtonLabel}
              </button>
            </div>

            {startError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{startError}</div> : null}
            {selected.enabled && !runtimeReady ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
                {chainTestBlockedReason({ saveStatus, status, statusError, runtimeSyncStatus, configurationSynced, selectedHasExecutableTarget, invalidTargetCount }, t)}
              </div>
            ) : null}

            {latestTest ? (
              <div className="grid gap-3 rounded-xl border border-ds-border bg-ds-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {activeTest ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Activity className="h-4 w-4 text-accent" />}
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${testStatusClass(latestTest.status)}`}>{testStatusLabel(latestTest.status, t)}</span>
                    <span className="text-[11px] text-ds-faint">{new Date(latestTest.createdAt).toLocaleString(i18n.resolvedLanguage)}</span>
                  </div>
                  <span className="text-[11px] text-ds-muted">{t('modelRoutes.attemptedTargets', { attempted: latestTest.attemptedTargets, total: latestTest.totalTargets })}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ds-main">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${testProgress(latestTest)}%` }} />
                </div>
                {latestTest.currentTarget ? <p className="text-[12px] text-ds-muted">{t('modelRoutes.testingTarget', { target: formatTarget(latestTest.currentTarget) })}</p> : null}
                {latestTest.selectedTarget ? <p className="text-[12px] text-emerald-700">{t('modelRoutes.finalTargetValue', { target: formatTarget(latestTest.selectedTarget) })}</p> : null}
                {latestTest.output ? <div className="rounded-lg bg-ds-main px-3 py-2 text-[12px] text-ds-muted">{t('modelRoutes.modelResponse', { response: latestTest.output })}</div> : null}
                {latestTest.error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{latestTest.error.message}{latestTest.error.category ? ` · ${latestTest.error.category}` : ''}</div> : null}
              </div>
            ) : status ? <div className="rounded-xl border border-dashed border-ds-border px-3 py-6 text-center text-[11px] text-ds-faint">{t('modelRoutes.noTests')}</div> : null}

            {latestTest?.attempts.length ? (
              <div className="overflow-hidden rounded-xl border border-ds-border">
                <div className="bg-ds-main px-3 py-2 text-[11px] font-medium text-ds-muted">{t('modelRoutes.currentTargetProgress')}</div>
                <table className="w-full text-left text-[11.5px]">
                  <thead className="text-ds-faint"><tr><th className="px-3 py-2">{t('modelRoutes.order')}</th><th className="px-3 py-2">{t('modelRoutes.target')}</th><th className="px-3 py-2">{t('modelRoutes.status')}</th><th className="px-3 py-2">{t('modelRoutes.latencyError')}</th></tr></thead>
                  <tbody>{latestTest.attempts.map((attempt) => (
                    <tr key={`${latestTest.id}-${attempt.targetId}`} className="border-t border-ds-border-muted text-ds-muted">
                      <td className="px-3 py-2">{attempt.index}</td>
                      <td className="px-3 py-2">{attempt.providerId} / {attempt.modelId}</td>
                      <td className="px-3 py-2">{attemptStatusLabel(attempt.status, t)}</td>
                      <td className="max-w-[320px] truncate px-3 py-2" title={attempt.message}>{attempt.latencyMs === undefined ? '—' : `${attempt.latencyMs} ms`}{attempt.category ? ` · ${attempt.category}` : ''}{attempt.message ? ` · ${attempt.message}` : ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}

            {selectedTests.length ? (
              <div className="overflow-hidden rounded-xl border border-ds-border">
                <div className="bg-ds-main px-3 py-2 text-[11px] font-medium text-ds-muted">{t('modelRoutes.recentTests')}</div>
                <table className="w-full text-left text-[11.5px]">
                  <thead className="text-ds-faint"><tr><th className="px-3 py-2">{t('modelRoutes.time')}</th><th className="px-3 py-2">{t('modelRoutes.result')}</th><th className="px-3 py-2">{t('modelRoutes.attempts')}</th><th className="px-3 py-2">{t('modelRoutes.finalTarget')}</th></tr></thead>
                  <tbody>{selectedTests.slice(0, 5).map((test) => (
                    <tr key={test.id} className="border-t border-ds-border-muted text-ds-muted">
                      <td className="px-3 py-2">{new Date(test.createdAt).toLocaleString(i18n.resolvedLanguage)}</td>
                      <td className="px-3 py-2">{testStatusLabel(test.status, t)}</td>
                      <td className="px-3 py-2">{test.attemptedTargets} / {test.totalTargets}</td>
                      <td className="px-3 py-2">{test.selectedTarget ? formatTarget(test.selectedTarget) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-xl border border-ds-border">
              <div className="bg-ds-main px-3 py-2 text-[11px] font-medium text-ds-muted">{t('modelRoutes.recentEvents')}</div>
              <table className="w-full text-left text-[11.5px]">
                <thead className="text-ds-faint"><tr><th className="px-3 py-2">{t('modelRoutes.time')}</th><th className="px-3 py-2">{t('modelRoutes.target')}</th><th className="px-3 py-2">{t('modelRoutes.result')}</th><th className="px-3 py-2">{t('modelRoutes.latency')}</th></tr></thead>
                <tbody>{events.map((event) => <tr key={`${event.at}-${event.targetId}-${event.result}`} className="border-t border-ds-border-muted text-ds-muted"><td className="px-3 py-2">{new Date(event.at).toLocaleTimeString(i18n.resolvedLanguage)}</td><td className="px-3 py-2">{event.providerId} / {event.modelId}</td><td className="px-3 py-2">{event.result}{event.category ? ` · ${event.category}` : ''}</td><td className="px-3 py-2">{event.latencyMs} ms</td></tr>)}</tbody>
              </table>
              {events.length === 0 ? <div className="px-3 py-6 text-center text-[11px] text-ds-faint">{t('modelRoutes.noEvents')}</div> : null}
            </div>
            </section>
          ) : (
            <EmptyRoutePoolState onAdd={addPool} t={t} />
          )}
        </SettingsTabPanel>
      </main>
    </div>
  )
}
