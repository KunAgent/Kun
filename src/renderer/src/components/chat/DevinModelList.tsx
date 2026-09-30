import { useState } from 'react'
import type { TFunction } from 'i18next'
import { Check, Cpu, Search, Sparkles } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { ProviderIcon } from '../provider-icon'
import { ModelCapabilityBadge } from './floating-composer-model-picker-rows'
import type { ComposerModelMenuGroup, ComposerReasoningEffort } from './floating-composer-model-picker-logic'
import { devinModelPresentation, readDevinRecentModels, rememberDevinModel } from './devin-model-presentation'

/** Devin's native model catalog. Labels are presentation only; selections always return exact wire IDs. */
export function DevinModelList({ group, currentModel, currentReasoning, reasoningOptions, onReasoningChange, onPick, t, maxHeight }: {
  group: ComposerModelMenuGroup; currentModel: string; currentReasoning: ComposerReasoningEffort
  reasoningOptions: { id: ComposerReasoningEffort; labelKey: string }[]
  onReasoningChange?: (value: ComposerReasoningEffort) => void
  onPick: (id: string) => void; t: TFunction; maxHeight: number
}) {
  const [query, setQuery] = useState('')
  const [fusion, setFusion] = useState(currentModel.startsWith('fusion-'))
  const [recent] = useState(readDevinRecentModels)
  const models = group.modelIds.map((id) => {
    const info = group.modelInfo?.[id] ?? { id }
    return { ...info, ...devinModelPresentation(info) }
  })
  const filter = query.trim().toLocaleLowerCase()
  const visible = models.filter((model) => filter
    ? `${model.name} ${model.id}`.toLocaleLowerCase().includes(filter) : model.fusion === fusion)
  const recentModels = !filter ? recent.flatMap((id) => visible.find((model) => model.id === id) ?? []).slice(0, 3) : []
  const remaining = visible.filter((model) => !recentModels.some((entry) => entry.id === model.id))
  const selected = models.find((model) => model.id === currentModel)
  const renderRow = (model: typeof models[number]) => <button type="button" role="menuitemradio"
    aria-checked={model.id === currentModel} key={model.id} title={model.name} data-devin-model={model.id}
    onClick={() => { rememberDevinModel(model.id); onPick(model.id) }}
    className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40 ${model.id === currentModel ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}>
    {model.brand === 'devin' ? <AgentIcon harnessId="devin" size={16} className="shrink-0" />
      : model.brand ? <ProviderIcon presetId={model.brand} providerId={model.brand} className="h-4 w-4 shrink-0" />
        : <Cpu size={16} className="shrink-0" />}
    <span className="min-w-0 flex-1">
      <span className="block break-words text-[13px] font-medium leading-5">{model.title}</span>
      {model.companion ? <span className="block break-words text-[11px] leading-4 text-ds-faint">{t('devinModels.withCompanion', { model: model.companion })}</span> : null}
    </span>
    {model.id === currentModel ? <Check size={15} className="shrink-0 text-accent" /> : null}
  </button>
  return <div className="flex min-h-0 flex-col" style={{ height: Math.max(140, maxHeight - 12) }} data-devin-model-list>
    <label className="mx-1 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-ds-border px-2.5 text-ds-faint">
      <Search size={14} />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        aria-label={t('composerModelSearchPlaceholder')} placeholder={t('composerModelSearchPlaceholder')}
        className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none" />
    </label>
    <div className="mx-1 mb-2 flex shrink-0 rounded-lg bg-ds-main p-0.5" aria-label={t('composerModel')}>
      {[false, true].map((value) => <button key={String(value)} type="button" aria-pressed={fusion === value}
        onClick={() => { setFusion(value); setQuery('') }} data-devin-model-category={value ? 'fusion' : 'model'}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium ${fusion === value ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-faint hover:text-ds-ink'}`}>
        {value ? <Sparkles size={13} /> : null}{value ? 'Fusion' : t('composerModel')}
        <span className="text-[10px] font-normal text-ds-faint">{models.filter((entry) => entry.fusion === value).length}</span>
      </button>)}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-devin-model-scroll>
      {recentModels.length ? <><div className="px-2.5 py-1 text-[11px] text-ds-faint">{t('devinModels.recent')}</div>{recentModels.map(renderRow)}</> : null}
      <div className="px-2.5 py-1 text-[11px] text-ds-faint">{filter ? t('devinModels.results') : fusion ? t('devinModels.fusionCombinations') : t('devinModels.nativeOrder')}</div>
      {remaining.map(renderRow)}
      {!visible.length ? <p className="px-2.5 py-3 text-[12px] text-ds-faint">{t('composerNoMatchingModels')}</p> : null}
    </div>
    {selected ? <div className="mt-2 shrink-0 space-y-2 border-t border-ds-border-muted px-2.5 pb-1 pt-2">
      <div className="flex items-start justify-between gap-2 text-[11px]">
        <span className="min-w-0 break-words text-ds-ink">{selected.name}</span>
        {selected.inputModalities ? <ModelCapabilityBadge kind={selected.inputModalities.includes('image') ? 'vision' : 'text'}
          label={t(selected.inputModalities.includes('image') ? 'composerModelVision' : 'composerModelTextOnly')} /> : null}
      </div>
      {selected.reasoningEfforts?.length && reasoningOptions.length && onReasoningChange ? <label className="flex items-center justify-between gap-2 text-[12px] text-ds-muted">
        {t('composerReasoning')}
        <select aria-label={t('composerReasoning')} value={currentReasoning} onChange={(event) => onReasoningChange(event.target.value as ComposerReasoningEffort)}
          className="max-w-[55%] rounded-md border border-ds-border bg-ds-card px-2 py-1 text-ds-ink">
          {reasoningOptions.map((option) => <option key={option.id} value={option.id}>{t(option.labelKey)}</option>)}
        </select>
      </label> : null}
    </div> : null}
  </div>
}
