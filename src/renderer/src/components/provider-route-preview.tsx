import type { ModelRoutePoolV1 } from '@shared/app-settings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsButtonClass } from './settings-button'

type Preview = { revision: number; strategy: string; affinity: string; maxAttempts: number;
  targets: Array<{ targetId: string; providerId: string; modelId: string; eligible: boolean; reason: string }>; guarantees: unknown; orderedTargetIds: string[]; affectedClients: Array<{clientId: string; excludedConnectionIds: string[]}> }
export function ProviderRoutePreview({ routeId, pool, disabled, translation }: { routeId: string; pool?: ModelRoutePoolV1; disabled: boolean; translation?: import('i18next').TFunction }) {
  const { t: localT } = useTranslation('settings')
  const t = translation ?? localT
  const [result, setResult] = useState<Preview>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [tools, setTools] = useState(false), [vision, setVision] = useState(false)
  return <div className="space-y-2 rounded-lg border border-ds-border-muted p-3 text-[12px]">
    <p className="text-ds-muted">{t('providerConfiguration.dryRunHint')}</p>
    <div className="flex flex-wrap items-center gap-3">
      <label><input type="checkbox" checked={tools} onChange={(event) => { setTools(event.target.checked); setResult(undefined) }} /> {t('providerConfiguration.requiresTools')}</label>
      <label><input type="checkbox" checked={vision} onChange={(event) => { setVision(event.target.checked); setResult(undefined) }} /> {t('providerConfiguration.requiresVision')}</label>
      <button className={settingsButtonClass()} disabled={disabled || busy} onClick={() => void (async () => {
        setBusy(true); setError(''); setResult(undefined)
        try {
          const response = await window.kunGui.runtimeRequest('/v1/provider-config/routes/preview', 'POST', JSON.stringify({ routeId, tools, vision, draft: pool }))
          const body = JSON.parse(response.body)
          if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
          setResult(body)
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      })()}>{t('providerConfiguration.dryRun')}</button>
    </div>
    {result ? <div className="max-h-64 space-y-1 overflow-auto">
      <p>{t('providerConfiguration.routePlan', { revision: result.revision, strategy: result.strategy, attempts: result.maxAttempts })}</p>
      <p>{t('providerConfiguration.strategyOrder', { order: result.orderedTargetIds?.join(' → ') || '—' })}</p>
      {result.affectedClients?.filter((client) => client.excludedConnectionIds.length).map((client) => <p key={client.clientId}>{t('providerConfiguration.affectedClient', { clientId: client.clientId, connections: client.excludedConnectionIds.join(', ') })}</p>)}
      {result.targets.map((target) => <p className="break-all" key={target.targetId}>{target.providerId} / {target.modelId} · {t(`providerConfiguration.reason.${target.reason}`)}</p>)}
      <pre className="whitespace-pre-wrap">{JSON.stringify(result.guarantees, null, 2)}</pre>
    </div> : null}
    <p className="text-ds-muted">{t('providerConfiguration.retryHealthHint')}</p>
    <button className={settingsButtonClass()} disabled={disabled || busy} onClick={() => void (async () => {
      setBusy(true); setError(''); setResult(undefined)
      try {
        const response = await window.kunGui.runtimeRequest(`/v1/model-routes/${encodeURIComponent(routeId)}/retry`, 'POST', '{}')
        if (!response.ok) throw new Error(JSON.parse(response.body).message ?? `HTTP ${response.status}`)
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { setBusy(false) }
    })()}>{t('providerConfiguration.retryHealth')}</button>
    <p className="text-ds-muted">{t('providerConfiguration.inferenceDisclosure')}</p>
    {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
  </div>
}
