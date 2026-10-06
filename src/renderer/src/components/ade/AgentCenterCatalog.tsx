import type { KeyboardEvent, ReactElement } from 'react'
import { Search, X } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileEnabled, selectedHarnessProfile, terminalHarnessProfileReady } from '@shared/harness-enablement'
import { harnessUnavailableLabelKey } from '../../store/harness-store'
import { AgentIcon } from '../agent-icon'
import { agentCardModel } from './agent-center-actions'
import { agentIntegrationKind, type AgentCatalogFilter } from './agent-center-catalog'

type T = (key: string, options?: Record<string, unknown>) => string

export function AgentCatalogControls({ filter, search, onFilter, onSearch, t }: {
  filter: AgentCatalogFilter
  search: string
  onFilter: (value: AgentCatalogFilter) => void
  onSearch: (value: string) => void
  t: T
}): ReactElement {
  return <div className="mb-3 space-y-2">
    <div className="relative">
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-faint" />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
        aria-label={t('agentIntegrations.search')} placeholder={t('agentIntegrations.search')}
        data-agent-catalog-search
        className="w-full rounded-lg border border-ds-border bg-ds-card py-2 pl-9 pr-9 text-[12px] text-ds-ink focus:border-accent focus:outline-none" />
      {search ? <button type="button" onClick={() => onSearch('')} aria-label={t('agentIntegrations.clearSearch')}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ds-muted hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent">
        <X size={14} />
      </button> : null}
    </div>
    <div role="group" aria-label={t('agentIntegrations.filterLabel')} className="flex flex-wrap gap-1">
      {(['all', 'chat', 'terminal', 'application'] as const).map((kind) => <button key={kind} type="button"
        data-agent-catalog-filter={kind} aria-pressed={filter === kind} onClick={() => onFilter(kind)}
        className={`rounded-lg px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${filter === kind ? 'bg-accent/10 font-medium text-accent' : 'text-ds-muted hover:bg-ds-hover'}`}>
        {t(`agentIntegrations.filters.${kind}`)}
      </button>)}
    </div>
  </div>
}

export function AgentCatalogRail({ rows, selectedId, settings, platform, onSelect, t, tSettings }: {
  rows: AdeHarnessRow[]
  selectedId?: string
  settings: KunHarnessSettingsV1
  platform: string
  onSelect: (id: string) => void
  t: T
  tSettings: T
}): ReactElement {
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number
    switch (event.key) {
      case 'ArrowDown': next = Math.min(rows.length - 1, index + 1); break
      case 'ArrowUp': next = Math.max(0, index - 1); break
      case 'Home': next = 0; break
      case 'End': next = rows.length - 1; break
      default: return
    }
    event.preventDefault()
    const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[data-agent-list-id]')[next]
    if (!target) return
    onSelect(rows[next].definition.id)
    target.focus()
  }
  return <div role="listbox" aria-label={tSettings('adeSettings.harnessesTitle')} aria-orientation="vertical"
    data-agent-catalog-rail
    className="flex max-h-64 min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain border-b border-ds-border-muted pb-3 md:max-h-[34rem] md:border-b-0 md:border-r md:pb-0 md:pr-3">
    {rows.map((row, index) => {
      const id = row.definition.id
      const kind = agentIntegrationKind(row)
      const model = agentCardModel(row, {
        enabled: id === 'kun' || harnessProfileEnabled(settings, selectedHarnessProfile(row, settings)),
        platform, isDefault: settings.defaultHarnessId === id,
        ...(kind === 'terminal' ? { ready: terminalHarnessProfileReady(row, selectedHarnessProfile(row, settings)) } : {})
      })
      const selected = selectedId === id
      const label = kind === 'application'
        ? t(row.status.detecting ? 'agentIntegrations.detecting' : row.status.installed === 'yes' ? 'agentIntegrations.installed' : row.status.installed === 'no' ? 'agentIntegrations.notInstalled' : 'agentIntegrations.installUnknown')
        : model.reasonCode ? t(harnessUnavailableLabelKey(model.reasonCode)) : tSettings(`adeSettings.agentState_${model.state}`)
      return <button key={id} type="button" role="option" data-agent-list-id={id} data-selected={selected || undefined}
        aria-selected={selected} tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(id)} onKeyDown={(event) => navigate(event, index)}
        className={`min-w-0 shrink-0 rounded-xl border-l-2 px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${selected ? 'border-accent bg-accent/10 text-ds-ink' : 'border-transparent text-ds-muted hover:bg-ds-hover'}`}>
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium" title={row.definition.displayName}>
          <AgentIcon harnessId={id} size={16} className="shrink-0 text-ds-muted" />
          <span className="truncate">{row.definition.displayName}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ds-faint">{t(`agentIntegrations.filters.${kind}`)} · {label}</span>
      </button>
    })}
  </div>
}
