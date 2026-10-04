import { GatewayLaunchProfile } from './gateway-launch-profile'
import type { TFunction } from 'i18next'
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderSettingsV1, ModelRoutePoolV1 } from '@shared/app-settings'
import { buildGatewayClientSetup, GATEWAY_CLIENTS, gatewaySetupDiff, type GatewayClientId } from '@shared/gateway-client-setup'
import { readyHarnessProfiles } from '@shared/harness-enablement'
import { loadHarnesses, useHarnessStore } from '../store/harness-store'
import { useChatStore } from '../store/chat-store'
import { settingsButtonClass } from './settings-button'
import { GatewayClientCredentials } from './gateway-client-credentials'
import type { RoutePoolTestRecord, RouteStatus } from './settings-section-model-routes'

export function GatewayConnectionCenter({ settings, pools, baseUrl, synced, active, tests, translation, exportableModelIds, gatewayExportPools, onEditRoute }: {
  settings: ModelProviderSettingsV1
  pools: ModelRoutePoolV1[]
  baseUrl: string
  synced: boolean
  active: boolean
  exportableModelIds: string[]
  gatewayExportPools: NonNullable<RouteStatus['gatewayExportPools']>
  tests: RoutePoolTestRecord[]
  translation?: TFunction
  onEditRoute: (poolId: string) => void
}): ReactElement {
  const { t: localT } = useTranslation('settings')
  const t = translation ?? localT
  const [clientId, setClientId] = useState<GatewayClientId>('codex')
  const [poolId, setPoolId] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const rows = useHarnessStore((state) => state.rows)
  const loading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const client = GATEWAY_CLIENTS.find((entry) => entry.id === clientId)!
  const enabledPools = pools.filter((pool) => pool.enabled && exportableModelIds.includes(pool.modelId))
  const pool = enabledPools.find((entry) => entry.id === poolId) ?? enabledPools[0]
  const exportPool = gatewayExportPools.find((entry) => entry.id === pool?.id && entry.modelId === pool?.modelId)
  const eligibleTargets = exportPool?.targets.filter((target) => target.exportable) ?? []
  const skippedTargets = exportPool?.targets.filter((target) => !target.exportable).length ?? 0
  const row = rows.find((entry) => entry.definition.id === clientId)
  const gatewayProfiles = row ? readyHarnessProfiles(row).filter((profile) => profile.credentialMode === 'kun-gateway') : []
  const inference = tests.find((test) => test.poolId === pool?.id && test.modelId === pool?.modelId && test.status === 'succeeded')
  const preview = useMemo(() => {
    if (!pool) return null
    try { return buildGatewayClientSetup(clientId, baseUrl, pool.modelId) } catch { return null }
  }, [clientId, baseUrl, pool])
  const copy = async (value: string): Promise<void> => {
    setCopyError(false)
    try { await navigator.clipboard.writeText(value); setCopied(true) }
    catch { setCopyError(true); setCopied(false) }
  }
  const manage = (): void => {
    useHarnessStore.setState({ settingsHarnessId: clientId })
    useChatStore.getState().openSettings('agentsHarnesses')
  }
  return <section className="mt-4 grid gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-connection-center>
    <div>
      <h3 className="text-[14px] font-semibold text-ds-ink">{t('gatewayConnection.title')}</h3>
      <p className="mt-1 text-[12px] leading-5 text-ds-muted">{t('gatewayConnection.description')}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-[11px] text-ds-muted">{t('gatewayConnection.client')}
        <select aria-label={t('gatewayConnection.client')} value={clientId} onChange={(event) => { setClientId(event.target.value as GatewayClientId); setCopied(false) }} className="rounded-lg border border-ds-border bg-ds-main px-3 py-2 text-[12px] text-ds-ink">
          {GATEWAY_CLIENTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-[11px] text-ds-muted">{t('gatewayConnection.alias')}
        <select aria-label={t('gatewayConnection.alias')} value={pool?.id ?? ''} disabled={!enabledPools.length} onChange={(event) => { setPoolId(event.target.value); setCopied(false) }} className="rounded-lg border border-ds-border bg-ds-main px-3 py-2 font-mono text-[12px] text-ds-ink">
          {!enabledPools.length ? <option value="">{t('gatewayConnection.noAlias')}</option> : enabledPools.map((entry) => <option key={entry.id} value={entry.id}>{entry.modelId}</option>)}
        </select>
      </label>
    </div>
    {pool ? <div className="rounded-lg bg-ds-main p-3 text-[11px] leading-5 text-ds-muted">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono font-semibold text-ds-ink">{pool.modelId}</span>
        <button type="button" className={settingsButtonClass()} onClick={() => onEditRoute(pool.id)}>{t('gatewayConnection.editRoute')}</button></div>
      <p>{t('gatewayConnection.aliasHint')}</p>
      <p className="mt-1 break-all" data-gateway-export-targets>{exportPool
        ? `${t('gatewayConnection.eligibleTargets')}: ${eligibleTargets.map((target) => `${settings.providers.find((provider) => provider.id === target.providerId)?.name ?? target.providerId} / ${target.modelId}`).join(' → ')}`
        : t('gatewayConnection.targetStatusPending')}</p>
      {skippedTargets > 0 ? <p className="text-amber-700" data-gateway-skipped-targets>{t('gatewayConnection.skippedTargets', { count: skippedTargets })}</p> : null}
      <p>{t('gatewayConnection.routeEvidence', { status: t(inference ? 'gatewayConnection.inferencePassed' : 'gatewayConnection.inferenceUntested') })}{inference ? ` (${new Date(inference.createdAt).toLocaleString()})` : ''}</p>
    </div> : <p className="text-[11px] text-amber-700">{t('gatewayConnection.noAlias')}</p>}
    <p className="text-[11px] text-ds-muted">{t('gatewayConnection.gatewayStatus', { status: t(settings.localGateway.enabled && synced ? 'gatewayConnection.applied' : 'gatewayConnection.notApplied') })}</p>
    <div className="grid gap-2 rounded-xl border border-ds-border p-3" data-gateway-managed-status>
      <h4 className="text-[12px] font-semibold text-ds-ink">{t('gatewayConnection.managedTitle', { client: client.label })}</h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ds-muted">
        <span>{t('gatewayConnection.installed')}: {t(row?.status.installed === 'yes' ? 'gatewayConnection.yes' : row?.status.installed === 'no' ? 'gatewayConnection.no' : 'gatewayConnection.unknown')}</span>
        <span>{t('gatewayConnection.nativeAccount')}: {t(row?.status.login === 'signed-in' ? 'gatewayConnection.signedIn' : row?.status.login === 'signed-out' ? 'gatewayConnection.signedOut' : 'gatewayConnection.unknown')}</span>
        <span>{t('gatewayConnection.managedReadiness')}: {t(gatewayProfiles.length ? 'gatewayConnection.checked' : 'gatewayConnection.needsCheck')}</span>
      </div>
      <p className="text-[11px] leading-5 text-ds-muted">{t('gatewayConnection.managedHint')}</p>
      <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayConnection.evidenceHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={settingsButtonClass()} onClick={manage}>{t('gatewayConnection.manageAgent')}</button>
        <button type="button" className={settingsButtonClass()} disabled={loading} onClick={() => void loadHarnesses(true)}>{t('gatewayConnection.refresh')}</button>
      </div>
      {rowsError ? <p role="alert" className="text-[11px] text-red-600">{rowsError}</p> : null}
    </div>
    <button type="button" className={settingsButtonClass()} aria-expanded={showPreview} onClick={() => setShowPreview((value) => !value)}>{t('gatewayConnection.standalone')}</button>
    {showPreview ? <div className="grid gap-3" data-gateway-standalone>
      <p className="text-[11px] leading-5 text-ds-muted">{t('gatewayConnection.manualHint')}</p>
      <GatewayClientCredentials clientName={client.label} active={active} />
      {preview ? <>
        <GatewayLaunchProfile key={`${clientId}:${preview.modelId}:${preview.baseUrl}`} setup={preview} />
        <ol className="list-inside list-decimal space-y-1 text-[11px] leading-5 text-ds-muted">
          <li>{t('gatewayConnection.stepKey')}</li>
          <li>{preview.fileName ? t('gatewayConnection.stepFile', { path: preview.fileName }) : t('gatewayConnection.stepEnvironment')}</li>
          <li>{t('gatewayConnection.stepLaunch')}</li>
          <li>{t('gatewayConnection.stepVerify')}</li>
        </ol>
        <p className="text-[11px] text-ds-muted">{client.protocol} · {preview.baseUrl}</p>
        <details className="rounded-lg border border-ds-border p-3"><summary className="cursor-pointer text-[12px] font-medium text-ds-ink">{t('gatewayConnection.diffTitle')}</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[11px] leading-5 text-ds-muted">{gatewaySetupDiff(preview)}</pre>
        </details>
        {preview.content ? <div><p className="mb-1 font-mono text-[11px] text-ds-muted">{preview.fileName}</p><pre className="overflow-x-auto rounded-lg bg-ds-main p-3 text-[11px] leading-5 text-ds-ink">{preview.content}</pre></div> : null}
        <div><p className="mb-1 text-[11px] text-ds-muted">{t('gatewayConnection.launchTitle')}</p><pre className="overflow-x-auto rounded-lg bg-ds-main p-3 text-[11px] leading-5 text-ds-ink">{preview.launch}</pre></div>
        <div className="flex flex-wrap gap-2">
          {preview.content ? <button type="button" className={settingsButtonClass()} onClick={() => void copy(preview.content!)}>{t('gatewayConnection.copyConfig')}</button> : null}
          <button type="button" className={settingsButtonClass()} onClick={() => void copy(preview.launch)}>{t('gatewayConnection.copyLaunch')}</button>
          {copied ? <span role="status" className="text-[11px] text-emerald-700">{t('gatewayConnection.copied')}</span> : null}
          {copyError ? <span role="alert" className="text-[11px] text-red-600">{t('gatewayConnection.copyFailed')}</span> : null}
        </div>
        <p className="text-[11px] leading-5 text-amber-700">{t('gatewayConnection.restoreHint')}</p>
      </> : <p className="text-[11px] text-amber-700">{t('gatewayConnection.noAlias')}</p>}
    </div> : null}
    <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayConnection.boundaries')}</p>
  </section>
}
