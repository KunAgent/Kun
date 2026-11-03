import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search } from 'lucide-react'
import { codingRouteKey, type CodingAgentRoute } from './coding-agent-client'
import { CODING_ROUTE_SEARCH_THRESHOLD, CODING_ROUTE_SOURCE_LABELS, codingRouteGroups, splitCodingModel } from './coding-agent-route-select-logic'
import { RoomPopover } from './RoomPopover'
import './coding-agent-route-select.css'

function ModelName({ model, gateway }: { model: string; gateway: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const { vendor, name } = splitCodingModel(model)
  return <>
    <span className="coding-route-name">{vendor ? <span className="coding-route-vendor">{vendor}/</span> : null}{name}</span>
    {gateway ? <span className="coding-route-tag">{t('directCodingAgentGatewayTag')}</span> : null}
  </>
}

/** A coding Agent's model as a compact chip; the list opens in the room popover layer. */
export function CodingAgentRouteSelect({ label, routes, value, disabled = false, onChange }: {
  label: string
  routes: readonly CodingAgentRoute[]
  value: CodingAgentRoute
  disabled?: boolean
  onChange: (key: string) => void
}): ReactElement {
  const gateway = value.credentialMode === 'kun-gateway'
  if (routes.length < 2) {
    return <span className="coding-route-chip is-static" title={value.model}><ModelName model={value.model} gateway={gateway} /></span>
  }
  return <RoomPopover label={label} align="end" width={320} maxHeight={420} disabled={disabled}
    className="coding-route-chip" trigger={<>
      <ModelName model={value.model} gateway={gateway} />
      <ChevronDown className="coding-route-chevron" size={14} strokeWidth={2} aria-hidden="true" />
    </>}>
    {(close) => <CodingRouteList label={label} routes={routes} selected={codingRouteKey(value)}
      onPick={(key) => { close(); if (key !== codingRouteKey(value)) onChange(key) }} />}
  </RoomPopover>
}

function CodingRouteList({ label, routes, selected, onPick }: {
  label: string
  routes: readonly CodingAgentRoute[]
  selected: string
  onPick: (key: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const searchable = routes.length >= CODING_ROUTE_SEARCH_THRESHOLD
  const groups = useMemo(() => codingRouteGroups(routes, query), [routes, query])
  const headed = groups.length > 1 || groups.some((group) => group.gateway)
  const options = (): HTMLButtonElement[] => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-route-option]') ?? [])

  // RoomPopover focuses its first control once placed; land on the current model instead.
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return
    const frame = requestAnimationFrame(() => {
      const current = options().find((option) => option.dataset.routeOption === selected)
      current?.scrollIntoView({ block: 'nearest' })
      if (!searchable) current?.focus()
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: later picks close the list
  }, [])

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const all = options()
    if (!all.length) return
    event.preventDefault()
    const index = all.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1
      : event.key === 'ArrowDown' ? Math.min(all.length - 1, index + 1) : index <= 0 ? -1 : index - 1
    if (next < 0 && searchable) list.current?.parentElement?.querySelector<HTMLInputElement>('input')?.focus()
    else all[Math.max(0, next)]?.focus()
  }
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); options()[0]?.focus() }
    else if (event.key === 'Enter') {
      event.preventDefault()
      const first = groups[0]?.rows[0]
      if (first) onPick(first.key)
    }
  }

  return <div className="coding-route-panel">
    {searchable ? <label className="coding-route-search">
      <Search size={14} aria-hidden="true" />
      <input type="search" value={query} placeholder={t('directCodingAgentSearchModels')} aria-label={t('directCodingAgentSearchModels')}
        onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} />
    </label> : null}
    <div ref={list} className="coding-route-list" role="listbox" aria-label={label} onKeyDown={onListKeyDown}>
      {groups.map((group) => <div key={group.id} role="group" aria-label={group.label || undefined}>
        {headed ? <div className="coding-route-group" aria-hidden="true">
          <span>{group.label || (group.mode ? t(CODING_ROUTE_SOURCE_LABELS[group.mode]) : label)}</span>
          {group.gateway && group.label ? <span className="coding-route-tag">{t('directCodingAgentGatewayTag')}</span> : null}
          <span className="coding-route-count">{group.rows.length}</span>
        </div> : null}
        {group.rows.map((row) => {
          const active = row.key === selected
          return <button key={row.key} type="button" role="option" aria-selected={active} data-route-option={row.key}
            className={`coding-route-option${active ? ' is-selected' : ''}`} title={row.route.model} onClick={() => onPick(row.key)}>
            <span className="coding-route-check" aria-hidden="true">{active ? <Check size={14} strokeWidth={2.4} /> : null}</span>
            <span className="coding-route-name">{headed ? row.name : row.route.model}</span>
          </button>
        })}
      </div>)}
      {!groups.length ? <p className="coding-route-empty" role="status">{t('directNoMatchingModels', { query: query.trim() })}</p> : null}
    </div>
  </div>
}
