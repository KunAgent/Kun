import { GatewayBudgetFields } from './gateway-budget-fields'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GatewayClientPolicySchema, legacyGatewayClientPolicy, type GatewayClientCredential } from '@shared/gateway-clients'
import type { GatewayClientPolicy, ProviderConfigurationSnapshot, ProviderConfigurationPreview } from '@shared/provider-configuration'
import { loadProviderConfiguration, previewProviderConfiguration, commitProviderConfiguration } from '../lib/provider-configuration-client'
import { settingsButtonClass } from './settings-button'
import { textInputClass, providerSelectControlClass } from './settings-section-providers-controls'

export function GatewayClientPolicyEditor({ client }: { client: GatewayClientCredential }) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ProviderConfigurationSnapshot>()
  const [policy, setPolicy] = useState<GatewayClientPolicy>(() => GatewayClientPolicySchema.parse({}))
  const [preview, setPreview] = useState<ProviderConfigurationPreview>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }, [])
  const reload = useCallback(async () => {
    const value = await loadProviderConfiguration()
    setSnapshot(value)
    setPolicy(value.configuration.gatewayPolicies[client.clientId] ??
      (client.scopeMode === 'scoped' ? GatewayClientPolicySchema.parse({}) : legacyGatewayClientPolicy()))
    setPreview(undefined)
  }, [client.clientId, client.scopeMode])
  useEffect(() => { if (open) void run(reload) }, [open, run, reload])
  const edit = (patch: Partial<GatewayClientPolicy>) => { setPolicy((current) => ({ ...current, ...patch })); setPreview(undefined) }
  const values = (element: HTMLSelectElement) => [...element.selectedOptions].map((option) => option.value)
  return <details className="w-full rounded-lg border border-ds-border-muted p-2" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-[12px] text-ds-ink">{t('providerConfiguration.clientPolicy')}</summary>
    {open ? <div className="mt-3 space-y-3 text-[12px] text-ds-ink">
      <p className="text-ds-muted">{t('providerConfiguration.clientPolicyHint')}</p>
      {snapshot ? <>
        <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} disabled={busy}
          onChange={(event) => edit({ enabled: event.target.checked })} />{t('providerConfiguration.clientEnabled')}</label>
        {policy.mode === 'legacy-unrestricted' ? <p className="text-ds-muted">{t('providerConfiguration.legacyPolicy')}</p> : null}
        <label className="block space-y-1"><span>{t('providerConfiguration.allowedRoutes')}</span>
          <select multiple size={Math.min(5, Math.max(2, snapshot.routePools.length))} className={providerSelectControlClass}
            disabled={busy} value={policy.allowedRouteIds} onChange={(event) => edit({ mode: 'scoped', allowedRouteIds: values(event.target) })}>
            {snapshot.routePools.map((route) => <option key={route.id} value={route.id}>{route.name} · {route.modelId}</option>)}
          </select>
        </label>
        <label className="block space-y-1"><span>{t('providerConfiguration.allowedConnections')}</span>
          <select multiple size={Math.min(5, Math.max(2, snapshot.connections.length))} className={providerSelectControlClass}
            disabled={busy} value={policy.allowedConnectionIds} onChange={(event) => edit({ mode: 'scoped', allowedConnectionIds: values(event.target) })}>
            {snapshot.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {connection.id}</option>)}
          </select>
        </label>
        <button className={settingsButtonClass()} disabled={busy} onClick={() => edit({ mode: 'scoped',
          allowedConnectionIds: [...new Set(snapshot.routePools.filter((route) => policy.allowedRouteIds.includes(route.id))
            .flatMap((route) => route.targets.filter((target) => target.enabled).map((target) => target.providerId)))]
        })}>{t('providerConfiguration.approveRouteConnections')}</button>
        <div className="flex flex-wrap gap-3">
          {(['chat_completions', 'responses', 'messages', 'gemini'] as const).map((protocol) => <label key={protocol} className="flex items-center gap-1">
            <input type="checkbox" checked={policy.allowedProtocols.includes(protocol)} disabled={busy}
              onChange={(event) => edit({ allowedProtocols: event.target.checked ? [...policy.allowedProtocols, protocol]
                : policy.allowedProtocols.filter((value) => value !== protocol) })} />{protocol}
          </label>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span>{t('providerConfiguration.concurrent')}</span><input className={textInputClass}
            type="number" min={1} max={128} disabled={busy} value={policy.maxConcurrent}
            onChange={(event) => edit({ maxConcurrent: Number(event.target.value) })} /></label>
          <label className="space-y-1"><span>{t('providerConfiguration.rpm')}</span><input className={textInputClass}
            type="number" min={1} max={60000} disabled={busy} value={policy.requestsPerMinute}
            onChange={(event) => edit({ requestsPerMinute: Number(event.target.value) })} /></label>
          <label className="space-y-1"><span>{t('providerConfiguration.expires')}</span><input className={textInputClass}
            type="datetime-local" disabled={busy} value={policy.expiresAt ? localDate(policy.expiresAt) : ''}
            onChange={(event) => edit({ expiresAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>
        </div>
        <GatewayBudgetFields policy={policy} edit={edit} disabled={busy} />
        <div className="flex flex-wrap gap-2">
          <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(async () => {
            const checked = GatewayClientPolicySchema.parse(policy)
            setPreview(await previewProviderConfiguration(snapshot.revision,
              [{ kind: 'set-client-policy', clientId: client.clientId, policy: checked }]))
          })}>{t('providerConfiguration.previewPolicy')}</button>
          <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(reload)}>{t('providerConfiguration.refresh')}</button>
        </div>
      </> : null}
      {preview ? <div className="space-y-2">
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(preview.operations, null, 2)}</pre>
        <button className={settingsButtonClass({ variant: 'primary' })} disabled={busy} onClick={() => void run(async () => {
          const result = await commitProviderConfiguration(preview)
          if (!result.applied) throw new Error(t('providerConfiguration.pendingActivation'))
          setSnapshot(result.snapshot); setPreview(undefined)
        })}>{t('providerConfiguration.apply')}</button>
      </div> : null}
      {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
    </div> : null}
  </details>
}

function localDate(value: string): string {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
