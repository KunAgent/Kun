import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Cpu, LoaderCircle, PencilLine, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessModels } from '@shared/ade-harnesses'
import { AgentIcon } from '../agent-icon'
import { ProviderIcon } from '../provider-icon'
import { DevinModelList } from '../chat/DevinModelList'
import { devinModelPresentation } from '../chat/devin-model-presentation'
import { useComposerPickerPopover } from '../chat/use-composer-picker-popover'
import { agentSettingFieldClass, agentSettingMenuClass, moveAgentPickerFocus } from './AgentSettingsSelect'

export function AgentSettingsModelPicker({ harnessId, native, value, modelIds, modelInfo, loading, error, onChange, onLoad }: {
  harnessId: string; native: boolean; value: string; modelIds: string[]; modelInfo?: AdeHarnessModels['modelInfo']
  loading?: boolean; error?: string; onChange: (model: string) => void; onLoad?: (force?: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const close = useCallback(() => setOpen(false), [])
  const id = useId()
  const devin = native && harnessId === 'devin'
  const info = useMemo(() => Object.fromEntries((modelInfo ?? []).map((entry) => [entry.id, entry])), [modelInfo])
  const label = value ? info[value]?.displayName || value : t('agentEnablement.nativeDefault')
  const selectedBrand = value && devin ? devinModelPresentation(info[value] ?? { id: value }).brand : undefined
  const height = devin && modelIds.length ? 460 : Math.min(440, Math.max(240, modelIds.length * 40 + 148))
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({ open, onClose: close,
    preferredWidth: 420, estimatedHeight: height, maximumHeight: 460 })
  const pick = (model: string): void => { if (model !== value) onChange(model); close(); triggerRef.current?.focus() }
  const show = (): void => { setQuery(''); setCustom(false); setCustomValue(value); setOpen(true); onLoad?.() }
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLInputElement>(
      custom ? '[data-agent-custom-model-input]' : 'input[type="search"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, custom, menuRef])
  const visible = modelIds.filter((model) => `${info[model]?.displayName ?? ''} ${model}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="w-full min-w-0">
    <button type="button" ref={triggerRef} className={agentSettingFieldClass} data-agent-profile-model
      aria-label={t('agentEnablement.model')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={label} onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); show() } }}>
      {selectedBrand && selectedBrand !== 'devin' ? <ProviderIcon presetId={selectedBrand} providerId={selectedBrand} className="h-4 w-4 shrink-0" />
        : <AgentIcon harnessId={harnessId} size={16} className="text-ds-muted" />}
      <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-ds-muted'}`}>{label}</span>
      <ChevronDown size={15} className="shrink-0 text-ds-faint" aria-hidden="true" />
    </button>
    {open ? createPortal(<div ref={menuRef} id={id} role="dialog" aria-label={t('agentEnablement.model')}
      data-agent-settings-model-menu className={`${agentSettingMenuClass} flex flex-col`}
      style={{ ...menuStyle, height: Math.min(height, Number(menuStyle.maxHeight) || height), visibility: menuStyle.left === undefined ? 'hidden' : 'visible' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); triggerRef.current?.focus() }
        else moveAgentPickerFocus(event)
      }} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== triggerRef.current) close()
      }}>
      <div className="mb-2 flex shrink-0 items-center gap-1 border-b border-ds-border-muted pb-1.5">
        <button type="button" role="menuitemradio" aria-checked={!value} data-agent-default-model
          onClick={() => pick('')} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-ds-muted hover:bg-ds-hover focus-visible:bg-ds-hover">
          <AgentIcon harnessId={harnessId} size={15} /><span className="min-w-0 flex-1 truncate">{t('agentEnablement.nativeDefault')}</span>
          {!value ? <Check size={14} className="text-accent" /> : null}
        </button>
        {onLoad ? <button type="button" disabled={loading} aria-label={t('agentEnablement.refreshModels')}
          title={t('agentEnablement.refreshModels')} onClick={() => onLoad(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button> : null}
      </div>
      {loading ? <div role="status" className="flex shrink-0 items-center gap-2 px-2.5 pb-2 text-[12px] text-ds-faint"><LoaderCircle size={13} className="animate-spin" />{t('loading')}</div> : null}
      {error ? <p role="alert" className="shrink-0 px-2.5 pb-2 text-[12px] text-ds-status-danger">{t('agentEnablement.modelsUnavailable')}</p> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {devin ? <DevinModelList fitContainer maxHeight={height} currentModel={value} currentReasoning="off"
          reasoningOptions={[]} group={{ providerId: 'ade-cred:native-login', label: t('adeCredential.nativeLogin'), nativeHarnessId: 'devin', modelIds, modelInfo: info }}
          onPick={pick} t={t} /> : <div className="flex h-full min-h-0 flex-col">
          <label className="mx-1 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-ds-border px-2.5 text-ds-faint focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10">
            <Search size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              aria-label={t('composerModelSearchPlaceholder')} placeholder={t('composerModelSearchPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none focus-visible:!outline-none focus-visible:!ring-0" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {visible.map((model) => <button key={model} type="button" role="menuitemradio" aria-checked={model === value}
              data-agent-model-option={model} onClick={() => pick(model)}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-ds-hover focus-visible:bg-ds-hover ${model === value ? 'bg-ds-hover' : 'text-ds-muted'}`}>
              <Cpu size={15} className="shrink-0 text-ds-faint" /><span className="min-w-0 flex-1 break-words">{info[model]?.displayName || model}</span>
              {model === value ? <Check size={15} className="shrink-0 text-accent" /> : null}
            </button>)}
            {!visible.length && !loading ? <p className="px-2.5 py-3 text-[12px] text-ds-faint">{t(query ? 'composerNoMatchingModels' : 'agentEnablement.noModels')}</p> : null}
          </div>
        </div>}
      </div>
      <div className="mt-2 shrink-0 border-t border-ds-border-muted pt-1.5">
        {custom ? <form className="flex gap-2 p-1" onSubmit={(event) => { event.preventDefault(); if (customValue.trim()) pick(customValue.trim()) }}>
          <input data-agent-custom-model-input aria-label={t('agentEnablement.customModel')} placeholder={t('agentEnablement.customModel')}
            value={customValue} onChange={(event) => setCustomValue(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-ds-border bg-transparent px-2.5 text-[12px] text-ds-ink outline-none focus:border-accent/50" />
          <button type="submit" data-agent-custom-model-apply disabled={!customValue.trim()}
            className="h-9 shrink-0 rounded-lg bg-accent px-3 text-[12px] text-white disabled:opacity-40">{t('agentEnablement.useModel')}</button>
        </form> : <button type="button" data-agent-custom-model onClick={() => setCustom(true)}
          className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-ds-muted hover:bg-ds-hover">
          <PencilLine size={14} />{t('agentEnablement.customModel')}
        </button>}
      </div>
    </div>, document.body) : null}
  </div>
}
