import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleDashed, Search, Settings2 } from 'lucide-react'
import { ProviderIcon } from '../provider-icon'
import type { AgentModelGroup, AgentModelRow, AgentModelRowNote, AgentModelSections } from './agent-model-select-logic'

export const AGENT_MODEL_INHERIT_KEY = '__inherit__'

const NOTE_KEYS: Record<AgentModelRowNote, string> = {
  scope: 'directScopeUnsupported',
  unavailable: 'directUnavailable',
  noBackground: 'directNoBackground',
  privateOnly: 'directPrivateOnly'
}

function optionId(listId: string, key: string, navKeys: readonly string[]): string | undefined {
  const index = navKeys.indexOf(key)
  return index < 0 ? undefined : `${listId}-option-${index}`
}

function Highlighted({ row }: { row: AgentModelRow }): ReactElement {
  if (!row.match) return <>{row.label}</>
  const [start, end] = row.match
  return <>{row.label.slice(0, start)}<mark>{row.label.slice(start, end)}</mark>{row.label.slice(end)}</>
}

type PanelProps = {
  panelRef: RefObject<HTMLDivElement | null>
  listId: string
  label: string
  style: CSSProperties
  above: boolean
  sections: AgentModelSections
  showInherit: boolean
  inheritSelected: boolean
  inheritedModel: string
  query: string
  active: string | null
  navKeys: readonly string[]
  onQuery: (query: string) => void
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onActive: (key: string) => void
  onPick: (key: string) => void
  onConfigureProviders?: () => void
}

/** The open list: search, "follow default", connections, then the ones that cannot run this Agent. */
export function AgentModelSelectPanel(props: PanelProps): ReactElement {
  const { panelRef, listId, label, style, above, sections, showInherit, inheritSelected, inheritedModel, query, active, navKeys,
    onQuery, onSearchKeyDown, onActive, onPick, onConfigureProviders } = props
  const { t } = useTranslation('common')
  const activeId = active ? optionId(listId, active, navKeys) : undefined
  const empty = !sections.available.length && !sections.unavailable.length

  useEffect(() => {
    if (typeof window === 'undefined') return
    const frame = window.requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [panelRef])
  // On open, center the current choice only when it is out of view; later moves scroll as little as possible.
  const opened = useRef(false)
  useEffect(() => {
    const first = !opened.current
    opened.current = true
    if (!activeId || typeof document === 'undefined') return
    const node = document.getElementById(activeId)
    if (typeof node?.scrollIntoView !== 'function') return
    const list = node.closest('[role="listbox"]')
    if (first && list) {
      const box = list.getBoundingClientRect(), row = node.getBoundingClientRect()
      if (row.top >= box.top && row.bottom <= box.bottom) return
    }
    node.scrollIntoView({ block: first ? 'center' : 'nearest' })
  }, [activeId])

  const renderRow = (row: AgentModelRow, groupLabel: string): ReactElement => {
    const id = row.disabled ? undefined : optionId(listId, row.key, navKeys)
    const note = row.note ? t(NOTE_KEYS[row.note]) : ''
    return <button key={row.key} id={id} type="button" role="option" tabIndex={-1} aria-selected={row.selected}
      aria-disabled={row.disabled || undefined} data-agent-model-option={row.key}
      title={[row.option.model, groupLabel, row.option.accountId, note].filter(Boolean).join(' · ')}
      className={`agent-model-select-row${row.selected ? ' is-selected' : ''}${row.disabled ? ' is-disabled' : ''}${active === row.key ? ' is-active' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => { if (!row.disabled && active !== row.key) onActive(row.key) }}
      onClick={() => { if (!row.disabled) onPick(row.key) }}>
      <span className="agent-model-select-row-name"><Highlighted row={row} /></span>
      {row.note ? <span className={`agent-model-select-tag${row.disabled ? ' is-muted' : ''}`}>{note}</span> : null}
      <span className="agent-model-select-check" aria-hidden="true">{row.selected ? <Check size={14} strokeWidth={2.6} /> : null}</span>
    </button>
  }
  const renderGroup = (group: AgentModelGroup, blocked: boolean): ReactElement =>
    <div key={group.key} role="group" aria-label={group.label} className={blocked ? 'is-blocked' : undefined}>
      <div className="agent-model-select-group" aria-hidden="true">
        <ProviderIcon providerId={group.providerId} presetId={group.presetSource} size={14} />
        <span className="agent-model-select-group-label">{group.label}</span>
        <span className="agent-model-select-group-count">{group.total}</span>
      </div>
      {group.reason ? <p className="agent-model-select-reason">{t(NOTE_KEYS[group.reason])}</p> : null}
      {group.rows.map((row) => renderRow(row, group.label))}
    </div>

  return <div ref={panelRef} role="dialog" aria-label={label} style={style} data-agent-model-panel
    className={`agent-model-select-panel${above ? ' is-above' : ''}`}>
    <label className="agent-model-select-search">
      <Search size={14} strokeWidth={1.9} aria-hidden="true" />
      <input type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={activeId} aria-label={t('directSearchModels')} placeholder={t('directSearchModels')}
        value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={onSearchKeyDown} />
    </label>
    <div id={listId} role="listbox" aria-label={label} className="agent-model-select-list">
      {showInherit ? <>
        <button id={optionId(listId, AGENT_MODEL_INHERIT_KEY, navKeys)} type="button" role="option" tabIndex={-1}
          aria-selected={inheritSelected} data-agent-model-option={AGENT_MODEL_INHERIT_KEY}
          className={`agent-model-select-inherit${inheritSelected ? ' is-selected' : ''}${active === AGENT_MODEL_INHERIT_KEY ? ' is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => { if (active !== AGENT_MODEL_INHERIT_KEY) onActive(AGENT_MODEL_INHERIT_KEY) }}
          onClick={() => onPick(AGENT_MODEL_INHERIT_KEY)}>
          <span className="agent-model-select-inherit-glyph" aria-hidden="true"><CircleDashed size={16} strokeWidth={2} /></span>
          <span className="agent-model-select-inherit-text">
            <span className="agent-model-select-inherit-title">{t('directFollowDefault')}</span>
            {inheritedModel ? <span className="agent-model-select-inherit-sub">{t('directInheritCurrent', { model: inheritedModel })}</span> : null}
          </span>
          <span className="agent-model-select-check" aria-hidden="true">{inheritSelected ? <Check size={14} strokeWidth={2.6} /> : null}</span>
        </button>
        <div className="agent-model-select-divider" role="separator" />
      </> : null}
      {sections.available.map((group) => renderGroup(group, false))}
      {sections.unavailable.length ? <>
        <div className="agent-model-select-section" role="presentation">{t('directUnavailableSection')}</div>
        {sections.unavailable.map((group) => renderGroup(group, true))}
      </> : null}
      {empty ? <div className="agent-model-select-empty" role="status">
        <p>{t('directNoMatchingModels', { query: query.trim() })}</p>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onQuery('')}>{t('directClearSearch')}</button>
      </div> : null}
    </div>
    <div className="agent-model-select-footer">
      {onConfigureProviders ? <button type="button" onClick={onConfigureProviders}>
        <Settings2 size={14} strokeWidth={1.9} aria-hidden="true" />{t('directConfigureProviders')}
      </button> : null}
      <span className="agent-model-select-keys" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd>{t('directKeysMove')}</span>
        <span><kbd>↵</kbd>{t('directKeysPick')}</span>
        <span><kbd>esc</kbd>{t('directKeysClose')}</span>
      </span>
    </div>
  </div>
}
