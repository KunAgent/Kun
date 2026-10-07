import type { KeyboardEvent, ReactElement } from 'react'
import { Search, X } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileEnabled, selectedHarnessProfile } from '@shared/harness-enablement'
import { harnessUnavailableLabelKey } from '../../store/harness-store'
import { AgentIcon } from '../agent-icon'
import { agentCardModel } from './agent-center-actions'
import { AgentStatusDot, agentStatusTone } from './AgentCenterParts'

type T = (key: string, options?: Record<string, unknown>) => string

export function AgentCatalogSearch({ search, onSearch, t }: {
  search: string
  onSearch: (value: string) => void
  t: T
}): ReactElement {
  return <div className="border-y border-ds-border-muted bg-ds-subtle px-4 py-2.5" data-agent-catalog-toolbar>
    <div className="relative">
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-faint" />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
        aria-label={t('agentIntegrations.search')} placeholder={t('agentIntegrations.search')}
        data-agent-catalog-search
        className="h-9 w-full rounded-lg border border-ds-border bg-ds-card pl-8 pr-9 text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
      {search ? <button type="button" onClick={() => onSearch('')} aria-label={t('agentIntegrations.clearSearch')}
        className="absolute right-0.5 top-1/2 grid -translate-y-1/2 place-items-center rounded-md text-ds-muted hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent">
        <X size={13} />
      </button> : null}
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
    className="flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain p-2 md:sticky md:top-0 md:max-h-[36rem]">
    {rows.map((row, index) => {
      const id = row.definition.id
      const model = agentCardModel(row, {
        enabled: id === 'kun' || harnessProfileEnabled(settings, selectedHarnessProfile(row, settings)),
        platform, isDefault: settings.defaultHarnessId === id
      })
      const selected = selectedId === id
      const label = model.reasonCode ? t(harnessUnavailableLabelKey(model.reasonCode)) : tSettings(`adeSettings.agentState_${model.state}`)
      const tone = agentStatusTone(model.state)
      return <button key={id} type="button" role="option" data-agent-list-id={id} data-selected={selected || undefined}
        aria-selected={selected} tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(id)} onKeyDown={(event) => navigate(event, index)}
        className={`flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/40 ${selected ? 'bg-ds-card text-ds-ink shadow-sm ring-1 ring-ds-border' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}>
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-card">
          <AgentIcon harnessId={id} size={16} className="text-ds-ink" />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full bg-ds-card">
            <AgentStatusDot tone={tone} className={tone === 'running' ? '!h-2.5 !w-2.5' : '!h-2 !w-2'} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5" title={row.definition.displayName}>
            <span className={`truncate text-[13px] ${selected ? 'font-semibold' : 'font-medium'}`}>{row.definition.displayName}</span>
            {settings.defaultHarnessId === id ? <span className="shrink-0 rounded px-1 text-[10px] font-medium leading-4 text-accent bg-accent-tint/10">{t('adeAgentAction.isDefault')}</span> : null}
          </span>
          <span className="mt-px block truncate text-[11px] text-ds-faint">{label}</span>
        </span>
      </button>
    })}
  </div>
}
