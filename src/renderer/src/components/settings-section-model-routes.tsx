import { settingsButtonClass } from './settings-button'
import type { ModelProviderSettingsV1, ModelRoutePoolV1, ModelRouteStrategy } from '@shared/app-settings'
import {
  DEFAULT_MODEL_ROUTE_FAILURE_POLICY,
  DEFAULT_MODEL_ROUTE_HEALTH_POLICY,
  projectExecutableModelRoutePools,
  resolveModelRouteTargetReference
} from '@shared/app-settings-provider-core'
import { KUN_MODEL_ROUTES_PATH, kunModelRouteTestPath } from '@shared/kun-endpoints'
import type { GatewayCredentialStatus } from '@shared/kun-gui-api'
import type { TFunction } from 'i18next'
import { Activity, Boxes, ChevronRight, Link2, Plus, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsSubTabs, SettingsTabPanel, Toggle } from './settings-controls'
import {
  EmptyRoutePoolState,
  LocalGatewayApiDialog,
  chainTestBlockedReason,
  parseCodes,
  routeStatusError,
  runtimeConfigurationMatches,
  runtimePoolMatches,
  uniqueValue,
  useValidatedTextDraft,
  validCodes
} from './settings-section-model-routes-support'
import { useGatewayCredentialControls } from './use-gateway-credential-controls'
import { useRuntimeSettingsSyncStatus } from './use-runtime-settings-sync-status'
import { GatewayStatusHeader, type GatewayHealth, type GatewayProblem } from './gateway-status-header'
import { GatewaySetupGuide } from './gateway-setup-guide'
import { GatewayAgentsPanel } from './gateway-agents-panel'
import { GatewayManualConnect } from './gateway-manual-connect'
import { GatewayConnectionCenter } from './gateway-connection-center'
import { GatewayRouteTracePanel } from './gateway-route-trace-panel'
import { GatewayAdvancedPanel } from './gateway-advanced-panel'
import { ModelRouteEditor } from './model-route-editor'
import { ModelRouteVerification } from './model-route-verification'

export type RouteStatus = {
  exportableModelIds?: string[]
  gatewayExportPools?: Array<{ id: string; modelId: string; exportable: boolean; targets: Array<{ id: string; providerId: string; modelId: string; exportable: boolean; reason?: string }> }>
  localGateway?: { enabled: boolean; exposeProviderModels?: boolean; credential?: GatewayCredentialStatus }
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
type LocalGatewayTab = 'connect' | 'models' | 'activity' | 'advanced'

const strategyTranslationKeys: Record<ModelRouteStrategy, string> = {
  priority: 'modelRoutes.strategyPriority',
  'round-robin': 'modelRoutes.strategyRoundRobin',
  'weighted-round-robin': 'modelRoutes.strategyWeightedRoundRobin',
  'least-latency': 'modelRoutes.strategyLeastLatency',
  'least-used': 'modelRoutes.strategyLeastUsed',
  adaptive: 'modelRoutes.strategyAdaptive',
  manual: 'routeRules.strategyManual'
}

/**
 * The local gateway page: a status line and a first-run guide on top, then
 * four tabs — connect agents and tools, the models the gateway offers, live
 * calls, and settings most people never touch.
 */
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
  const runtimeSyncStatus = useRuntimeSettingsSyncStatus(active)
  const [startPending, setStartPending] = useState(false)
  const [startError, setStartError] = useState('')
  const [credentialError, setCredentialError] = useState('')
  const [apiDocsOpen, setApiDocsOpen] = useState(false)
  const [guideCopied, setGuideCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<LocalGatewayTab>('connect')
  const [connectedAgents, setConnectedAgents] = useState(0)
  const gatewayCredential = useGatewayCredentialControls(settings, onChange, setCredentialError)
  const credential = gatewayCredential.credential
  const credentialPending = gatewayCredential.pending
  const selected = settings.routePools.find((pool) => pool.id === selectedId) ?? settings.routePools[0]
  const executablePools = useMemo(() => projectExecutableModelRoutePools(settings), [settings])
  const executableSelected = executablePools.find((pool) => pool.id === selected?.id)
  const configurationSynced = useMemo(
    () => runtimeConfigurationMatches(
      executablePools,
      settings.localGateway.enabled,
      settings.localGateway.exposeProviderModels,
      status
    ),
    [executablePools, settings.localGateway.enabled, settings.localGateway.exposeProviderModels, status]
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
      capabilityMode: 'guaranteed',
      affinity: { mode: 'turn', ttlMs: 1_800_000 },
      targets: provider ? [{ id: `${id}-target-1`, providerId: provider.id, modelId: provider.models[0], enabled: true, weight: 1 }] : [],
      failurePolicy: { ...DEFAULT_MODEL_ROUTE_FAILURE_POLICY, failoverHttpStatusCodes: [...DEFAULT_MODEL_ROUTE_FAILURE_POLICY.failoverHttpStatusCodes] },
      healthPolicy: { ...DEFAULT_MODEL_ROUTE_HEALTH_POLICY }
    }
    onChange({ ...settings, routePools: [...settings.routePools, pool] })
    setSelectedId(id)
    setActiveTab('models')
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
  const activeTest = selectedTests[0]?.status === 'queued' || selectedTests[0]?.status === 'running'
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

  const enabled = settings.localGateway.enabled
  const runtimeSyncFailed = Boolean(!configurationSynced && runtimeSyncStatus?.state === 'failed')
  const runtimeDownLabel = runtimeSyncStatus?.state === 'unavailable' ? t('modelRoutes.runtimeNotRunning') : t('modelRoutes.runtimeNotConnected')
  const gatewaySectionIssue = runtimeSyncStatus?.sections?.localModelGateway
  const gatewayFixable = Boolean(
    gatewaySectionIssue && ['gateway_key_missing', 'gateway_disabled'].includes(gatewaySectionIssue.code)
  )
  const health: GatewayHealth = saveStatus === 'error' || runtimeSyncFailed || gatewaySectionIssue || credentialError
    ? 'problem'
    : !enabled ? 'off' : !status ? 'down' : saveStatus === 'saving' || !configurationSynced ? 'pending' : 'running'
  const stateLabel = {
    running: t('gatewaySetup.stateRunning'),
    off: t('gatewaySetup.stateOff'),
    down: runtimeDownLabel,
    problem: t('gatewaySetup.stateProblem'),
    pending: saveStatus === 'saving' ? t('modelRoutes.localSaveSaving')
      : runtimeSyncStatus?.state === 'syncing' ? t('modelRoutes.runtimeSyncing') : t('modelRoutes.runtimeWaitingForSync')
  }[health]
  const problems: GatewayProblem[] = [
    ...(saveStatus === 'error' ? [{ id: 'save', tone: 'error' as const, text: t('modelRoutes.localSaveFailed'), detail: saveError ?? undefined,
      ...(onRetrySave ? { action: { label: t('modelRoutes.retrySave'), onClick: onRetrySave } } : {}) }] : []),
    ...(runtimeSyncFailed ? [{ id: 'sync', tone: 'error' as const, text: t('modelRoutes.runtimeSyncFailed'), detail: runtimeSyncStatus?.message }] : []),
    ...(credentialError ? [{ id: 'key', tone: 'error' as const, text: t('gatewaySetup.keyFailed'), detail: credentialError }] : []),
    ...(gatewaySectionIssue ? [{ id: 'gateway', tone: 'warn' as const,
      text: t(`modelRoutes.gatewayIssue.${gatewaySectionIssue.code}`, { defaultValue: gatewaySectionIssue.message }),
      ...(gatewayFixable ? { action: { label: t('modelRoutes.gatewayFix'), disabled: credentialPending,
        onClick: () => void (gatewaySectionIssue.code === 'gateway_disabled' ? gatewayCredential.setEnabled(true) : gatewayCredential.update('ensure')) } } : {}) }] : []),
    ...(!status && statusError && enabled ? [{ id: 'runtime', tone: 'warn' as const, text: runtimeDownLabel, detail: t('modelRoutes.runtimeUnavailableHint') }] : [])
  ]
  const origin = publicBaseUrl.replace(/\/+$/, '')
  const gatewayBaseUrl = `${origin}/v1`
  const exportableModelIds = status?.exportableModelIds
  const sampleModelId = executablePools.find((pool) => pool.enabled && exportableModelIds?.includes(pool.modelId))?.modelId
    ?? exportableModelIds?.[0]
  const enabledPools = settings.routePools.filter((pool) => pool.enabled).length
  const copyGuideText = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setGuideCopied(true)
      globalThis.setTimeout(() => setGuideCopied(false), 1_800)
    } catch { setGuideCopied(false) }
  }
  const chooseAgent = (): void => {
    setActiveTab('connect')
    globalThis.requestAnimationFrame?.(() => globalThis.document?.querySelector('[data-gateway-agents]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const setShared = (exposeProviderModels: boolean): void => onChange({ ...settings, localGateway: { ...settings.localGateway, exposeProviderModels } })

  return (
    <div className="grid min-w-0 content-start gap-4" data-local-gateway>
      <GatewayStatusHeader t={t} health={health} stateLabel={stateLabel} enabled={enabled} togglePending={credentialPending}
        onToggle={(on) => { void gatewayCredential.setEnabled(on) }} address={gatewayBaseUrl}
        modelCount={exportableModelIds?.length} agentCount={connectedAgents} problems={problems} />
      <GatewaySetupGuide t={t} address={gatewayBaseUrl} enabled={enabled} keyReady={credential.configured} models={exportableModelIds}
        sharing={settings.localGateway.exposeProviderModels} agents={connectedAgents} pending={credentialPending}
        onEnable={() => { void gatewayCredential.setEnabled(true) }} onShareModels={() => setShared(true)}
        onCreateRoute={addPool} onChooseAgent={chooseAgent} />

      <SettingsSubTabs<LocalGatewayTab>
        baseId="model-routes-settings"
        ariaLabel={t('modelRoutes.tabsAria')}
        items={[
          { id: 'connect', label: t('gatewaySetup.tabs.connect'), icon: Link2 },
          { id: 'models', label: t('gatewaySetup.tabs.models'), icon: Boxes },
          { id: 'activity', label: t('gatewaySetup.tabs.activity'), icon: Activity },
          { id: 'advanced', label: t('gatewaySetup.tabs.advanced'), icon: SlidersHorizontal }
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel baseId="model-routes-settings" tabId="connect" active={activeTab === 'connect'} className="grid min-w-0 content-start gap-6">
        <GatewayAgentsPanel active={active} translation={t} onConnectedCount={setConnectedAgents} onPrepareModels={() => setActiveTab('models')} />
        <GatewayManualConnect t={t} origin={origin} models={exportableModelIds ?? []} keyConfigured={credential.configured}
          keyPending={credentialPending} onCopyKey={() => gatewayCredential.update('copy')}
          onPrepareModels={() => setActiveTab('models')} onOpenGuide={() => setApiDocsOpen(true)} />
        <details className="group grid min-w-0 gap-2.5" data-gateway-standalone-details>
          <summary className="flex cursor-pointer list-none items-start gap-1.5 px-1 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted transition-transform group-open:rotate-90" />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-ds-ink">{t('gatewaySetup.standaloneTitle')}</span>
              <span className="mt-0.5 block text-[12px] leading-5 text-ds-muted">{t('gatewaySetup.standaloneDesc')}</span>
            </span>
          </summary>
          <div className="mt-2.5 min-w-0">
            <GatewayConnectionCenter translation={t} settings={settings} pools={executablePools} baseUrl={gatewayBaseUrl}
              gatewayExportPools={status?.gatewayExportPools ?? []} exportableModelIds={exportableModelIds ?? []}
              synced={configurationSynced && persistenceReady} active={active && activeTab === 'connect'} tests={status?.tests ?? []}
              onEditRoute={(id) => { setSelectedId(id); setActiveTab('models') }} />
          </div>
        </details>
      </SettingsTabPanel>

      <SettingsTabPanel baseId="model-routes-settings" tabId="models" active={activeTab === 'models'} className="grid min-w-0 content-start gap-4">
        <section className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl border border-ds-border bg-ds-card px-4 py-3.5" data-gateway-shared-models>
          <div className="min-w-[14rem] flex-1">
            <div className="text-[13px] font-semibold text-ds-ink">{t('modelRoutes.exposeProviderModels')}</div>
            <p className="mt-0.5 max-w-[46rem] text-[11.5px] leading-5 text-ds-muted">{t('modelRoutes.exposeProviderModelsDesc')}</p>
          </div>
          <Toggle checked={settings.localGateway.exposeProviderModels} onChange={setShared} ariaLabel={t('modelRoutes.exposeProviderModels')} />
        </section>
        <div className="grid min-w-0 gap-4 rounded-2xl border border-ds-border bg-ds-card p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="grid min-w-0 content-start gap-3 border-b border-ds-border-muted pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ds-ink">{t('modelRoutes.routedModels')}</h3>
                <span className="text-[11px] text-ds-faint">{t('modelRoutes.enabledModelCount', { enabled: enabledPools, total: settings.routePools.length })}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-ds-faint">{t('gatewaySetup.routedModelsDesc')}</p>
            </div>
            <button type="button" onClick={addPool} className={settingsButtonClass({ size: 'compact' })}>
              <Plus className="h-3.5 w-3.5" /> {t('modelRoutes.addModel')}
            </button>
            <div className="grid gap-1.5">
              {settings.routePools.map((pool) => {
                const executablePool = executablePools.find((candidate) => candidate.id === pool.id)
                const available = executablePool?.targets.filter((target) => target.enabled).length ?? 0
                const invalid = pool.targets.length - (executablePool?.targets.length ?? 0)
                return (
                  <button key={pool.id} type="button" onClick={() => setSelectedId(pool.id)} aria-current={selected?.id === pool.id}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${selected?.id === pool.id ? 'border-accent bg-accent-tint/5' : 'border-transparent hover:bg-ds-hover'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[12.5px] font-semibold text-ds-ink">{pool.modelId}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${executablePool?.enabled ? 'bg-ds-status-dot-success' : invalid > 0 ? 'bg-ds-status-dot-warning' : 'bg-ds-status-dot-muted'}`} />
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ds-faint">{pool.name}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ds-muted">
                      <span>{t('modelRoutes.availableTargets', { available, total: pool.targets.length })}{invalid > 0 ? ` · ${t('modelRoutes.invalidTargets', { count: invalid })}` : ''}</span>
                      <span className="truncate">{strategies.find((item) => item.id === pool.strategy)?.label}</span>
                    </div>
                  </button>
                )
              })}
              {settings.routePools.length === 0 ? <div className="rounded-xl border border-dashed border-ds-border px-3 py-6 text-center text-[12px] text-ds-faint">{t('modelRoutes.noModels')}</div> : null}
            </div>
          </aside>
          <div className="min-w-0">
            {selected ? <ModelRouteEditor t={t} settings={settings} pool={selected} strategies={strategies} metrics={status?.metrics}
              modelIdDraft={modelIdDraft} failoverCodesDraft={failoverCodesDraft} onUpdate={updatePool} onRemove={removePool}
              verification={<ModelRouteVerification t={t} locale={i18n.resolvedLanguage} pool={selected} statusLoaded={Boolean(status)}
                runtimeReady={runtimeReady} startPending={startPending} startError={startError} buttonLabel={testButtonLabel}
                blockedReason={selected.enabled && !runtimeReady
                  ? chainTestBlockedReason({ saveStatus, status, statusError, runtimeSyncStatus, configurationSynced, selectedHasExecutableTarget, invalidTargetCount }, t)
                  : ''}
                tests={selectedTests} events={events} onRun={() => void runTest()} />} />
              : <EmptyRoutePoolState onAdd={addPool} t={t} />}
          </div>
        </div>
      </SettingsTabPanel>

      <SettingsTabPanel baseId="model-routes-settings" tabId="activity" active={activeTab === 'activity'} className="grid min-w-0 content-start gap-4">
        <GatewayRouteTracePanel active={active && activeTab === 'activity'} t={t} />
      </SettingsTabPanel>

      <SettingsTabPanel baseId="model-routes-settings" tabId="advanced" active={activeTab === 'advanced'} className="grid min-w-0 content-start gap-4">
        <GatewayAdvancedPanel t={t} settings={settings} onChange={onChange} active={active && activeTab === 'advanced'}
          credential={credential} keyPending={credentialPending} onKeyAction={(action) => { void gatewayCredential.update(action) }} />
      </SettingsTabPanel>

      {apiDocsOpen ? <LocalGatewayApiDialog
        baseUrl={gatewayBaseUrl}
        modelId={sampleModelId || 'your-public-model-id'}
        copied={guideCopied}
        onClose={() => setApiDocsOpen(false)}
        onCopy={(value) => void copyGuideText(value)}
      /> : null}
    </div>
  )
}
