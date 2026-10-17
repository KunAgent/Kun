import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessEnabledProfileV1 } from '@shared/app-settings'
import { loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { AgentSection } from './AgentCenterParts'
import { settingsButtonClass } from '../settings-button'
import { AgentDraftBar } from './AgentDraftBar'
import { agentModelGroupSections } from '../chat/composer-provider-model-sections'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * Tab 2: the models this connection can use. The first row is always the
 * Agent's own default; choosing another model is an edit like any other
 * connection change, so it waits for a re-check.
 */
export function AgentModelsTab({ row, entry, profile, dirty, busy, onChange, onDiscard, onRecheck, t }: {
  row: AdeHarnessRow
  entry: KunHarnessDefaultsEntryV1
  profile: KunHarnessEnabledProfileV1
  dirty: boolean
  busy: boolean
  onChange: (patch: Partial<KunHarnessDefaultsEntryV1>) => void
  onDiscard: () => void
  onRecheck: () => void
  t: T
}): ReactElement {
  const id = row.definition.id
  const native = profile.credentialMode === 'native-login'
  const nativeModels = useHarnessStore((state) => state.models[id])
  const groups = useHarnessStore((state) => state.providerGroups[id])
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState('')
  const group = groups?.groups.find((candidate) => candidate.providerId === profile.providerId)
  const alias = groups?.aliasGroups?.find((candidate) => candidate.routeId === profile.gatewayBinding?.main.routeId)
  const modelIds = native ? nativeModels?.models ?? row.definition.staticModels : alias ? [alias.modelId] : group?.models ?? []
  const info = useMemo(() => Object.fromEntries((native ? nativeModels?.modelInfo : group?.modelInfo ?? alias?.modelInfo ?? [])?.map((model) => [model.id, model]) ?? []), [native, nativeModels?.modelInfo, group?.modelInfo, alias?.modelInfo])
  const loading = native ? nativeModels?.loading : groups?.loading
  const failed = native ? nativeModels?.error : groups?.error
  const reload = (force = true): void => {
    if (native) void loadHarnessModels(id, force)
    else void loadHarnessProviderGroups(id, force)
  }
  useEffect(() => { if (native && !nativeModels) void loadHarnessModels(id) }, [id, native, nativeModels])
  const current = entry.model ?? ''
  const needle = query.trim().toLocaleLowerCase()
  const visible = modelIds.filter((model) => `${info[model]?.displayName ?? ''} ${model}`.toLocaleLowerCase().includes(needle))
  const loadedAt = native ? nativeModels?.catalogStatus?.fetchedAt : undefined

  // Whether the list is grouped is decided on the full catalog so a filter never drops the headings.
  const sections = agentModelGroupSections(modelIds, info)
  const visibleIds = new Set(visible)
  const rowClass = 'flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2'
  const renderModel = (model: string): ReactElement => {
    const details = info[model]
    return <div key={model} data-agent-model-row={model} className={rowClass}>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px] text-ds-ink">{model}</span>
        {details?.displayName && details.displayName !== model ? <span className="block truncate text-[11.5px] text-ds-faint">{details.displayName}</span> : null}
      </span>
      {details?.reasoningEfforts?.length ? <span className="flex flex-wrap gap-1">{details.reasoningEfforts.map((effort) =>
        <span key={effort} className="rounded-md bg-ds-subtle px-1.5 text-[11px] leading-[18px] text-ds-muted">{effort}</span>)}</span> : null}
      {current === model ? <span className="rounded-md bg-accent-tint/10 px-1.5 text-[11px] font-medium leading-[18px] text-accent">{t('agentCenter.models.current')}</span>
        : <button type="button" onClick={() => onChange({ model })} className="text-[12px] font-medium text-accent hover:underline">{t('agentCenter.models.use')}</button>}
    </div>
  }
  return <AgentSection title={t('agentCenter.models.title')}
    description={loadedAt ? t('agentCenter.models.updated', { source: t(native ? 'agentCenter.models.fromAgent' : 'agentCenter.models.fromProvider'), time: new Date(loadedAt).toLocaleTimeString() })
      : t(native ? 'agentCenter.models.fromAgent' : 'agentCenter.models.fromProvider')}
    action={<div className="flex shrink-0 items-center gap-2">
      <label className="relative block">
        <Search aria-hidden size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-faint" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('composerModelSearchPlaceholder')}
          placeholder={t('composerModelSearchPlaceholder')} data-agent-models-search
          className="h-8 w-44 rounded-lg border border-ds-border bg-ds-card pl-7 pr-2 text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-accent focus:outline-none" />
      </label>
      <button type="button" disabled={loading} onClick={() => reload()} data-agent-models-refresh className={settingsButtonClass({ size: 'compact' })}>
        {loading ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />}
        {t('agentUpdate.refreshModels')}
      </button>
    </div>}>
    <AgentDraftBar dirty={dirty} busy={busy} onDiscard={onDiscard} onRecheck={onRecheck} t={t} />
    <div data-agent-models-list>
      <div className={rowClass}>
        <span className="min-w-0 flex-1 text-[13px] text-ds-ink">{t('agentEnablement.nativeDefault')}</span>
        {current === '' ? <span className="rounded-md bg-accent-tint/10 px-1.5 text-[11px] font-medium leading-[18px] text-accent">{t('agentCenter.models.current')}</span>
          : <button type="button" onClick={() => onChange({ model: undefined })} className="text-[12px] font-medium text-accent hover:underline">{t('agentCenter.models.use')}</button>}
      </div>
      {sections ? sections.map((section) => {
        const rows = section.modelIds.filter((model) => visibleIds.has(model))
        return rows.length ? <div key={section.key} role="group" aria-label={section.label} data-agent-model-group={section.key}>
          <p className="px-3 pb-0.5 pt-2.5 text-[11.5px] font-semibold text-ds-faint">{section.label}</p>
          {rows.map(renderModel)}
        </div> : null
      }) : visible.map(renderModel)}
      {loading ? <div role="status" className="flex items-center gap-2 px-3 py-3 text-[12px] text-ds-faint"><LoaderCircle aria-hidden size={13} className="animate-spin" />{t('loading')}</div> : null}
      {failed && !modelIds.length ? <p role="alert" className="px-3 py-3 text-[12px] text-ds-status-danger">{t('agentEnablement.modelsUnavailable')}</p> : null}
      {!loading && !failed && !visible.length ? <p className="px-3 py-3 text-[12px] text-ds-faint">{t(needle ? 'composerNoMatchingModels' : 'agentEnablement.noModels')}</p> : null}
    </div>
    <form className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" onSubmit={(event) => {
      event.preventDefault()
      if (custom.trim()) { onChange({ model: custom.trim() }); setCustom('') }
    }}>
      <label htmlFor={`agent-model-id-${id}`} className="text-[12px] text-ds-muted">{t('agentCenter.models.customLabel')}</label>
      <span className="flex gap-2">
        <input id={`agent-model-id-${id}`} value={custom} onChange={(event) => setCustom(event.target.value)} spellCheck={false}
          placeholder={t('agentEnablement.customModel')} data-agent-models-custom
          className="h-8 w-56 rounded-lg border border-ds-border bg-ds-card px-2.5 font-mono text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-accent focus:outline-none" />
        <button type="submit" disabled={!custom.trim()} className={settingsButtonClass({ size: 'compact' })}>{t('agentEnablement.useModel')}</button>
      </span>
    </form>
  </AgentSection>
}
