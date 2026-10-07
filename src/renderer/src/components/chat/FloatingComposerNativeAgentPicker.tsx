import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Sparkles, UserRound } from 'lucide-react'
import { loadHarnessModels, useHarnessStore } from '../../store/harness-store'
import {
  harnessSupportsNativeAgents,
  nativeAgentLabel,
  nativeAgentOptions,
  selectHarnessNativeAgent,
  useHarnessNativeAgentStore
} from '../../lib/harness-native-agent'
import { useComposerPickerPopover } from './use-composer-picker-popover'

const MENU_WIDTH = 272
const MENU_ESTIMATED_HEIGHT = 260

type Props = {
  harnessId: string
  threadId?: string | null
  compact?: boolean
  disabled?: boolean
}

/**
 * Native Agent switch for external harnesses that publish switchable Agents
 * (OpenCode build/plan/custom agents). "Auto" keeps Kun's permission-mapped
 * mode; a picked Agent applies to the next turns sent to this harness.
 */
export function FloatingComposerNativeAgentPicker({ harnessId, threadId, compact = false, disabled }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const row = useHarnessStore((state) => state.rows.find((entry) => entry.definition.id === harnessId))
  const catalog = useHarnessStore((state) => state.models[harnessId])
  const session = useHarnessStore((state) => threadId ? state.sessions[threadId] : undefined)
  const selectedId = useHarnessNativeAgentStore((state) => state.selected[harnessId])
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const supported = harnessSupportsNativeAgents(row)

  useEffect(() => {
    if (supported && open && !catalog?.agents?.length && !catalog?.loading) void loadHarnessModels(harnessId)
  }, [catalog?.agents?.length, catalog?.loading, harnessId, open, supported])

  const closeMenu = useCallback((): void => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open, onClose: closeMenu, preferredWidth: MENU_WIDTH, estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  if (!supported || !row) return null
  const agents = nativeAgentOptions({
    row,
    sessionAgents: session?.harnessId === harnessId ? session.agents : undefined,
    catalogAgents: catalog?.agents
  })
  const selected = selectedId ? agents.find((agent) => agent.id === selectedId) ?? { id: selectedId } : undefined
  const triggerName = selected ? nativeAgentLabel(selected) : t('nativeAgentPicker.auto')
  const title = t('nativeAgentPicker.triggerTitle', { agent: row.definition.displayName, name: triggerName })

  const pick = (agentId: string | undefined): void => {
    selectHarnessNativeAgent(harnessId, agentId)
    setOpen(false)
    triggerRef.current?.focus()
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    if (!items.length) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1)
    items[next]?.focus()
  }
  const itemClass = (checked: boolean): string =>
    `flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition focus-visible:bg-ds-hover ${
      checked ? 'bg-accent-soft text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'}`

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t('nativeAgentPicker.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      onKeyDown={onMenuKeyDown}
      data-native-agent-menu={harnessId}
      className="ds-composer-agent-menu ds-no-drag fixed z-50 overflow-hidden rounded-lg border border-ds-border bg-ds-main p-1 shadow-xl"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ds-faint">
        {row.definition.displayName} · {t('nativeAgentPicker.title')}
      </div>
      <button type="button" role="menuitemradio" aria-checked={!selected} data-native-agent="" onClick={() => pick(undefined)} className={itemClass(!selected)}>
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate${!selected ? ' font-semibold' : ''}`}>{t('nativeAgentPicker.auto')}</span>
          <span className="block truncate text-[11.5px] text-ds-muted">{t('nativeAgentPicker.autoHint')}</span>
        </span>
        <span className="flex w-4 shrink-0 justify-center">{!selected ? <Check className="mt-0.5 h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : null}</span>
      </button>
      {agents.map((agent) => {
        const checked = selected?.id === agent.id
        return (
          <button key={agent.id} type="button" role="menuitemradio" aria-checked={checked} data-native-agent={agent.id}
            title={agent.description ?? agent.id} onClick={() => pick(agent.id)} className={itemClass(checked)}>
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate${checked ? ' font-semibold' : ''}`}>{nativeAgentLabel(agent)}</span>
              {agent.description ? <span className="block truncate text-[11.5px] text-ds-muted">{agent.description}</span> : null}
            </span>
            <span className="flex w-4 shrink-0 justify-center">{checked ? <Check className="mt-0.5 h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : null}</span>
          </button>
        )
      })}
      <div className="mt-1 border-t border-ds-border-muted px-2.5 pb-1 pt-2 text-[11px] leading-4 text-ds-faint">
        {t('nativeAgentPicker.ownPermissions')}
      </div>
    </div>
  ) : null

  return (
    <>
      <div className="ds-composer-agent-picker ds-no-drag relative" data-native-agent-picker={harnessId}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={open}
          aria-label={title}
          title={title}
          onClick={() => setOpen((current) => !current)}
          className={`flex h-7 items-center gap-1 rounded-full border border-ds-border bg-ds-raised px-2 text-xs transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60 ${
            selected ? 'text-ds-ink' : 'text-ds-muted'}`}
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {!compact ? <span className="max-w-[120px] truncate">{triggerName}</span> : null}
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.75} />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
