import type { ProviderVerificationEvidence } from '../../../../kun/src/contracts/provider-verification-evidence.js'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsButtonClass } from './settings-button'
import { textInputClass } from './settings-section-providers-controls'

type Catalog = { evidence?: ProviderVerificationEvidence; fetchedAt: string; source?: string; stale?: boolean; identityChanged?: boolean;
  models: string[]; selectedModels?: string[]; manualModels?: string[]; unavailableModels?: string[] }
export function ProviderCatalogObservation({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation('settings')
  const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const fetchCatalog = useCallback(async () => {
    const response = await window.kunGui.runtimeRequest(`/v1/model-connections/${encodeURIComponent(connectionId)}/catalog`, 'GET')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = JSON.parse(response.body)
    return (body.cached === true ? body : null) as Catalog | null
  }, [connectionId])
  useEffect(() => {
    let live = true
    setCatalog(null); setSearch(''); setPage(0); setError('')
    void fetchCatalog().then((value) => { if (live) setCatalog(value) }).catch(() => undefined)
    return () => { live = false }
  }, [connectionId, fetchCatalog])
  const rows = [...new Set([...(catalog?.models ?? []), ...(catalog?.selectedModels ?? []), ...(catalog?.manualModels ?? [])])]
    .filter((model) => model.toLowerCase().includes(search.toLowerCase()))
  return <div className="space-y-2 rounded-lg border border-ds-border-muted p-3 sm:col-span-2">
    <p>{t('providerConfiguration.catalogEvidence')}</p>
    {catalog ? <p className="text-ds-muted">{t(catalog.identityChanged ? 'providerConfiguration.catalogDifferentAccount'
      : catalog.stale ? 'providerConfiguration.catalogStale' : 'providerConfiguration.catalogObserved', {
      time: new Date(catalog.fetchedAt).toLocaleString(), source: catalog.source ?? 'unknown' })}</p>
      : <p className="text-ds-muted">{t('providerConfiguration.catalogUnknown')}</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ds-muted">
      {(['credential', 'connectivity', 'catalog', 'protocol', 'inference'] as const).map((stage) => <span key={stage}>
        {t(`providerConfiguration.evidence${stage}`)}: {t(`providerConfiguration.evidence${catalog?.evidence?.[stage]?.status ?? 'unknown'}`)}
      </span>)}
    </div>
    <button className={settingsButtonClass()} disabled={busy} onClick={() => void (async () => {
      setBusy(true); setError('')
      try {
        const response = await window.kunGui.runtimeRequest(`/v1/model-connections/${encodeURIComponent(connectionId)}/probe`, 'POST', '{}')
        if (!response.ok) throw new Error(t('providerConfiguration.catalogFailed'))
        setCatalog(await fetchCatalog())
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setCatalog(await fetchCatalog().catch(() => null)) }
      finally { setBusy(false) }
    })()}>{t('providerConfiguration.refreshCatalog')}</button>
    <p className="text-[12px] text-ds-muted">{t('providerConfiguration.inferenceTestHint')}</p>
    <button className={settingsButtonClass()} disabled={busy || !catalog?.selectedModels?.length} onClick={() => void (async () => {
      setBusy(true); setError('')
      try {
        const response = await window.kunGui.runtimeRequest('/v1/model-requests', 'POST', JSON.stringify({ purpose: 'provider-test',
          providerId: connectionId, model: catalog!.selectedModels![0], messages: [{ role: 'user', content: 'Reply with OK.' }], maxOutputTokens: 8, timeoutMs: 30000 }))
        const result = JSON.parse(response.body)
        if (!response.ok || result.ok !== true) throw new Error(result.message ?? t('providerConfiguration.catalogFailed'))
        setCatalog(await fetchCatalog())
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { setBusy(false) }
    })()}>{t('providerConfiguration.inferenceTest')}</button>
    <input aria-label={t('providerConfiguration.searchModels')} placeholder={t('providerConfiguration.searchModels')} className={textInputClass}
      value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} />
    <div className="max-h-48 overflow-auto text-[12px]">
      {rows.slice(page * 50, page * 50 + 50).map((model) => <p className="break-all" key={model}>{model} · {
        t(catalog?.manualModels?.includes(model) ? 'providerConfiguration.modelManual'
          : catalog?.unavailableModels?.includes(model) ? 'providerConfiguration.modelUnavailable'
            : catalog?.selectedModels?.includes(model) ? 'providerConfiguration.modelSelected' : 'providerConfiguration.modelDiscovered')
      }</p>)}
    </div>
    {rows.length > 50 ? <div className="flex items-center gap-2">
      <button className={settingsButtonClass()} disabled={page === 0} onClick={() => setPage(page - 1)}>←</button>
      <span>{page + 1} / {Math.ceil(rows.length / 50)}</span>
      <button className={settingsButtonClass()} disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>→</button>
    </div> : null}
    {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
  </div>
}
