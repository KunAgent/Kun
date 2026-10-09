import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronDown, Cpu, Loader2 } from 'lucide-react'
import type { AgentModelBinding } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { currentBodyZoom } from '../chat/floating-composer-model-picker-logic'
import { ProviderIcon } from '../provider-icon'
import { modelBindingKey } from './agent-client'
import { AgentModelSelectPanel, AGENT_MODEL_INHERIT_KEY } from './AgentModelSelectPanel'
import {
  AGENT_MODEL_POPOVER_MAX_HEIGHT, AGENT_MODEL_POPOVER_MIN_WIDTH, agentModelLabel, agentModelNoteBlocks,
  agentModelPopoverPlacement, agentModelRowNote, agentModelSections, agentProviderLabel, findAgentModelOption,
  type AgentModelPopoverPlacement, type AgentModelRole
} from './agent-model-select-logic'
import type { DirectModelOption } from './room-direct-model-groups'
import './agent-model-select.css'

export type AgentModelPick = { providerId: string; accountId?: string; model: string }

/**
 * One Agent role's model: a field-sized trigger showing the model that will
 * run, and a searchable list grouped by connection. Picking "follow default"
 * reports `null`.
 */
export function AgentModelSelect({ role, label, options, selected, inherited, disabled = false, busy = false, onChange, onConfigureProviders }: {
  role: AgentModelRole
  label: string
  options: readonly DirectModelOption[]
  selected: AgentModelBinding | null
  inherited?: AgentModelBinding
  disabled?: boolean
  busy?: boolean
  onChange: (next: AgentModelPick | null) => void
  onConfigureProviders?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const codeGroups = useChatStore((state) => state.composerModelGroups)
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [placement, setPlacement] = useState<AgentModelPopoverPlacement | null>(null)

  const sections = useMemo(() => agentModelSections({ options, codeGroups, selected, role, query }),
    [options, codeGroups, selected, role, query])
  const showInherit = !query.trim()
  const navKeys = useMemo(() => [...(showInherit ? [AGENT_MODEL_INHERIT_KEY] : []), ...sections.navigable.map((row) => row.key)],
    [sections, showInherit])

  const effective = selected ?? inherited
  const effectiveOption = findAgentModelOption(options, effective)
  const effectiveNote = effectiveOption ? agentModelRowNote(effectiveOption, role) : undefined
  const broken = Boolean(effective) && (!effectiveOption || agentModelNoteBlocks(effectiveNote))
  const modelText = effective ? agentModelLabel(effective, codeGroups) : t('directChooseModel')
  const providerText = agentProviderLabel(effective, options, codeGroups)
  const metaText = broken ? [t('directUnavailable'), providerText].filter(Boolean).join(' · ') : providerText
  const title = [effective?.model, providerText, effective?.accountId].filter(Boolean).join(' · ')

  const close = (focusTrigger: boolean): void => {
    setOpen(false)
    setQuery('')
    if (focusTrigger) triggerRef.current?.focus()
  }
  const openList = (): void => {
    if (disabled) return
    setActive(selected ? modelBindingKey(selected) : AGENT_MODEL_INHERIT_KEY)
    setOpen(true)
  }
  // Saving disables the field, which drops focus; give it back to the trigger afterwards.
  const refocus = useRef(false)
  const pick = (key: string): void => {
    const row = key === AGENT_MODEL_INHERIT_KEY ? undefined : sections.navigable.find((entry) => entry.key === key)
    if (key !== AGENT_MODEL_INHERIT_KEY && !row?.option.providerId) return
    close(true)
    if (row ? row.selected : !selected) return
    refocus.current = true
    onChange(row?.option.providerId ? { providerId: row.option.providerId, accountId: row.option.accountId, model: row.option.model } : null)
  }

  useEffect(() => {
    if (disabled) { setOpen(false); return }
    if (!refocus.current) return
    refocus.current = false
    if (typeof document !== 'undefined' && (document.activeElement === document.body || !document.activeElement)) triggerRef.current?.focus()
  }, [disabled])
  // A new query starts from its first result so Enter picks it.
  useEffect(() => { if (open && query.trim()) setActive(sections.navigable[0]?.key ?? null) }, [open, query, sections])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open) { setPlacement(null); return }
    if (typeof window === 'undefined') return
    const update = (): void => {
      const trigger = triggerRef.current
      if (!trigger) return
      setPlacement(agentModelPopoverPlacement({ anchor: trigger.getBoundingClientRect(),
        contentHeight: panelRef.current?.scrollHeight ?? AGENT_MODEL_POPOVER_MAX_HEIGHT,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, scale: currentBodyZoom() }))
    }
    update()
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      update()
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!navKeys.length) return
      const index = active ? navKeys.indexOf(active) : -1
      const next = event.key === 'ArrowDown' ? Math.min(navKeys.length - 1, index + 1) : Math.max(0, index - 1)
      setActive(navKeys[index < 0 ? 0 : next] ?? null)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const key = active && navKeys.includes(active) ? active : navKeys[0]
      if (key) pick(key)
    }
  }

  const panelStyle: CSSProperties = placement
    ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }
    : { left: 0, top: 0, width: AGENT_MODEL_POPOVER_MIN_WIDTH, maxHeight: AGENT_MODEL_POPOVER_MAX_HEIGHT, visibility: 'hidden' }
  const panel = open ? <AgentModelSelectPanel panelRef={panelRef} listId={listId} label={label} style={panelStyle}
    above={Boolean(placement?.above)} sections={sections} showInherit={showInherit} inheritSelected={!selected}
    inheritedModel={inherited ? agentModelLabel(inherited, codeGroups) : ''} query={query} active={active} navKeys={navKeys}
    onQuery={setQuery} onSearchKeyDown={onSearchKeyDown} onActive={setActive} onPick={pick}
    onConfigureProviders={onConfigureProviders ? () => { close(false); onConfigureProviders() } : undefined} /> : null

  return <div className="agent-model-select" data-agent-model-select={role}>
    <button ref={triggerRef} type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} title={title || undefined} data-agent-model-trigger={role}
      className={`agent-model-select-trigger${open ? ' is-open' : ''}${broken ? ' is-broken' : ''}${busy ? ' is-busy' : ''}`}
      onClick={() => (open ? close(false) : openList())}
      onKeyDown={(event) => {
        if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
        event.preventDefault()
        openList()
      }}>
      <span className="agent-model-select-icon" aria-hidden="true">
        {broken ? <AlertCircle size={16} strokeWidth={2} />
          : effective?.providerId ? <ProviderIcon providerId={effective.providerId}
            presetId={codeGroups.find((group) => group.providerId === effective.providerId)?.presetSource} size={18} />
            : <Cpu size={16} strokeWidth={1.8} />}
      </span>
      <span className="agent-model-select-text">
        <span className="agent-model-select-model">{modelText}</span>
        {metaText ? <span className="agent-model-select-meta">{metaText}</span> : null}
      </span>
      {!selected ? <span className="agent-model-select-badge">{t('directFollowDefault')}</span> : null}
      {busy ? <Loader2 className="agent-model-select-spinner" size={16} strokeWidth={2.2} aria-hidden="true" />
        : <ChevronDown className="agent-model-select-chevron" size={16} strokeWidth={2} aria-hidden="true" />}
    </button>
    {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
  </div>
}
