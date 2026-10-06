import { ProviderTemplateActions } from './provider-template-actions'
import { ProviderCatalogObservation } from './provider-catalog-observation'
import { ProviderAdvancedFields } from './provider-advanced-fields'
import { useEffect, useState } from 'react'
import type { ProviderConfigurationOperation, ProviderConfigurationPreview,
  ProviderConfigurationSnapshot, ProviderConnectionConfiguration } from '@shared/provider-configuration'
import { commitProviderConfiguration, exportProviderConfiguration, loadProviderConfiguration,
  previewProviderConfiguration, previewProviderConfigurationImport } from '../lib/provider-configuration-client'
import { textInputClass, providerSelectControlClass } from './settings-section-providers-controls'
import { settingsButtonClass } from './settings-button'

type T = (key: string, options?: Record<string, unknown>) => string
export function ProviderConfigurationPanel({ t, activeProviderId }: { t: T; activeProviderId?: string }) {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ProviderConfigurationSnapshot>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(activeProviderId ?? '')
  const [draft, setDraft] = useState<ProviderConnectionConfiguration>({ enabled: true, inherit: [], manualModels: [] })
  const [anonymous, setAnonymous] = useState(false)
  const [groupName, setGroupName] = useState(''), [groupBase, setGroupBase] = useState('')
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<ProviderConfigurationPreview>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const connection = snapshot?.connections.find((item) => item.id === selected)
  const groups = Object.values(snapshot?.configuration.groups ?? {})
  const reload = async () => {
    const next = await loadProviderConfiguration(); setSnapshot(next)
    setSelected((value) => next.connections.some((item) => item.id === value) ? value : next.connections[0]?.id ?? '')
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => { if (open) void run(reload) }, [open])
  useEffect(() => {
    if (!snapshot) return
    setDraft(snapshot.configuration.connections[selected] ?? { enabled: true, inherit: [], manualModels: [] })
    setAnonymous(snapshot.connections.find((item) => item.id === selected)?.authType === 'none')
    setPreview(undefined)
  }, [selected, snapshot])
  const edit = (value: Partial<ProviderConnectionConfiguration>) => {
    setDraft((current) => ({ ...current, ...value })); setPreview(undefined)
  }
  const review = async (operations: ProviderConfigurationOperation[]) => {
    if (!snapshot) return
    setPreview(await previewProviderConfiguration(snapshot.revision, operations))
  }
  const apply = async () => {
    if (!preview) return
    const result = await commitProviderConfiguration(preview)
    setSnapshot(result.snapshot); setPreview(undefined)
    setNotice(t(result.applied ? 'providerConfiguration.applied' : 'providerConfiguration.pendingActivation'))
  }
  return <details className="mt-4 rounded-xl border border-ds-border bg-ds-card" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ds-ink">{t('providerConfiguration.title')}</summary>
    {open ? <div className="space-y-4 border-t border-ds-border-muted p-4 text-[13px] text-ds-ink">
      <p className="text-ds-muted">{t('providerConfiguration.description')}</p>
      {snapshot ? <>
        <p className="text-[12px] text-ds-muted">{t('providerConfiguration.revision', { saved: snapshot.revision, active: snapshot.activeRevision })}</p>
        <input className={textInputClass} value={search} aria-label={t('providerConfiguration.searchConnections')} placeholder={t('providerConfiguration.searchConnections')}
          onChange={(event) => setSearch(event.target.value)} />
        <label className="block space-y-1"><span>{t('providerConfiguration.connection')}</span>
          <select className={providerSelectControlClass} value={selected} disabled={busy}
            onChange={(event) => setSelected(event.target.value)}>
            {snapshot.connections.filter((item) => item.id === selected || `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
          </select>
        </label>
        {connection ? <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span>{t('providerConfiguration.group')}</span>
            <select className={providerSelectControlClass} value={draft.groupId ?? ''} disabled={busy}
              onChange={(event) => edit({ groupId: event.target.value || undefined })}>
              <option value="">{t('providerConfiguration.noGroup')}</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} disabled={busy}
            onChange={(event) => edit({ enabled: event.target.checked })} />{t('providerConfiguration.enabled')}</label>
          {connection.kind === 'http' && ['api-key', 'none'].includes(connection.authType) ? <label className="flex items-center gap-2"><input type="checkbox" checked={anonymous} disabled={busy}
            onChange={(event) => { setAnonymous(event.target.checked); setPreview(undefined) }} />{t('providerConfiguration.anonymous')}</label> : null}
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.inherit.includes('baseUrl')} disabled={busy || !draft.groupId}
            onChange={(event) => edit({ inherit: event.target.checked ? [...new Set([...draft.inherit, 'baseUrl' as const])]
              : draft.inherit.filter((field) => field !== 'baseUrl') })} />{t('providerConfiguration.inheritEndpoint')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.admission)} disabled={busy}
            onChange={(event) => edit({ admission: event.target.checked
              ? { maxConcurrent: 8, maxQueued: 32, queueWaitMs: 10_000 } : undefined })} />{t('providerConfiguration.limitAccount')}</label>
          {draft.admission ? <>
            <label className="space-y-1"><span>{t('providerConfiguration.inputTokenUpperBound')}</span><input className={textInputClass}
              type="number" min={1} max={16777216} value={draft.admission.inputTokenUpperBound ?? ''} disabled={busy}
              onChange={(event) => edit({ admission: { ...draft.admission!, inputTokenUpperBound: event.target.value ? Number(event.target.value) : undefined } })} /></label>
            <label className="space-y-1"><span>{t('providerConfiguration.concurrent')}</span><input className={textInputClass}
              type="number" min={1} max={128} value={draft.admission.maxConcurrent} disabled={busy}
              onChange={(event) => edit({ admission: { ...draft.admission!, maxConcurrent: Number(event.target.value) } })} /></label>
            <label className="space-y-1"><span>{t('providerConfiguration.queueSize')}</span><input className={textInputClass}
              type="number" min={0} max={1024} value={draft.admission.maxQueued} disabled={busy}
              onChange={(event) => edit({ admission: { ...draft.admission!, maxQueued: Number(event.target.value) } })} /></label>
            <label className="space-y-1"><span>{t('providerConfiguration.queueWait')}</span><input className={textInputClass}
              type="number" min={1} max={120000} value={draft.admission.queueWaitMs} disabled={busy}
              onChange={(event) => edit({ admission: { ...draft.admission!, queueWaitMs: Number(event.target.value) } })} /></label>
          </> : null}
          <label className="space-y-1"><span>{t('providerConfiguration.discovery')}</span>
            <select className={providerSelectControlClass} value={draft.discovery?.mode ?? 'auto'} disabled={busy}
              onChange={(event) => edit({ discovery: event.target.value === 'custom'
                ? { mode: 'custom', modelsUrl: connection.baseUrl ?? '', itemsPointer: '/data', idPointer: '/id', credentialHosts: [], maxPages: 10 }
                : { mode: event.target.value === 'manual' ? 'manual' : 'auto' } })}>
              {['auto', 'manual', 'custom'].map((mode) => <option key={mode} value={mode}>{t(`providerConfiguration.discovery${mode}`)}</option>)}
            </select>
          </label>
          {draft.discovery?.mode === 'custom' ? <label className="space-y-1"><span>{t('providerConfiguration.modelsUrl')}</span>
            <input className={textInputClass} value={draft.discovery.modelsUrl} disabled={busy}
              onChange={(event) => { if (draft.discovery?.mode === 'custom') edit({ discovery: { ...draft.discovery, modelsUrl: event.target.value } }) }} />
          </label> : null}
          <ProviderCatalogObservation key={selected} connectionId={selected} />
          <ProviderTemplateActions snapshot={snapshot} connectionId={selected} disabled={busy} review={(operations) => void run(() => review(operations))} />
          <ProviderAdvancedFields draft={draft} edit={edit} baseUrl={connection.baseUrl} sources={snapshot.fieldSources[selected]} disabled={busy} />
          <div><button className={settingsButtonClass()} disabled={busy} onClick={() => void run(() => review([
            { kind: 'configure-connection', connectionId: selected, configuration: draft },
            ...(draft.manualModels.some((model) => !connection.models.includes(model)) ? [{ kind: 'patch-connection' as const, connectionId: selected,
              patch: { models: [...new Set([...connection.models, ...draft.manualModels])] } }] : []),
            ...(connection.kind === 'http' && anonymous !== (connection.authType === 'none')
              ? [{ kind: 'patch-connection' as const, connectionId: selected, patch: { authType: anonymous ? 'none' as const : 'api-key' as const } }] : [])
          ]))}>{t('providerConfiguration.preview')}</button></div>
        </div> : null}
        <div className="space-y-2 rounded-lg border border-ds-border-muted p-3">
          <label className="block space-y-1"><span>{t('providerConfiguration.groupName')}</span>
            <input className={textInputClass} value={groupName} disabled={busy} onChange={(event) => { setGroupName(event.target.value); setPreview(undefined) }} />
          </label>
          <label className="block space-y-1"><span>{t('providerConfiguration.groupBase')}</span>
            <input className={textInputClass} value={groupBase} disabled={busy} onChange={(event) => { setGroupBase(event.target.value); setPreview(undefined) }} />
          </label>
          <button className={settingsButtonClass()} disabled={busy || !groupName.trim()} onClick={() => void run(() => review([
            { kind: 'put-group', group: { id: `pg_${crypto.randomUUID()}`, name: groupName.trim(), enabled: true,
              defaults: groupBase.trim() ? { baseUrl: groupBase.trim() } : {} } }
          ]))}>{t('providerConfiguration.createGroup')}</button>
        </div>
        <div className="space-y-2">
          <label className="block space-y-1"><span>{t('providerConfiguration.document')}</span>
            <textarea className={`${textInputClass} min-h-36 font-mono text-[12px]`} value={importText} disabled={busy}
              onChange={(event) => { setImportText(event.target.value); setPreview(undefined) }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(async () => {
              setImportText(JSON.stringify(await exportProviderConfiguration(), null, 2)); setPreview(undefined)
            })}>{t('providerConfiguration.export')}</button>
            <button className={settingsButtonClass()} disabled={busy || !importText.trim()} onClick={() => void run(async () => {
              setPreview(await previewProviderConfigurationImport(snapshot.revision, JSON.parse(importText)))
            })}>{t('providerConfiguration.import')}</button>
            <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(reload)}>{t('providerConfiguration.refresh')}</button>
          </div>
        </div>
      </> : null}
      {preview ? <div className="space-y-2 rounded-lg border border-ds-border-muted p-3">
        <p>{t('providerConfiguration.impact', { count: preview.affectedConnections.length })}</p>
        {preview.remaps ? <pre className="max-h-32 overflow-auto text-[11px]">{JSON.stringify(preview.remaps, null, 2)}</pre> : null}
        {preview.secretSlots?.length ? <p>{t('providerConfiguration.secretSlots', { count: preview.secretSlots.length })}</p> : null}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(preview.operations, null, 2)}</pre>
        <button className={settingsButtonClass({ variant: 'primary' })} disabled={busy} onClick={() => void run(apply)}>{t('providerConfiguration.apply')}</button>
      </div> : null}
      {busy ? <p role="status">{t('providerConfiguration.working')}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
    </div> : null}
  </details>
}
