import type { ReactElement } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown } from 'lucide-react'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { primaryAgentAvailableOnSurface } from '../../lib/subagent-profile-surface'
import { useComposerPickerPopover } from './use-composer-picker-popover'

const MENU_WIDTH = 256
const MENU_ESTIMATED_HEIGHT = 240

type Props = {
  /** When true, render only the icon. */
  compact?: boolean
  /** Disable selection (e.g. busy or non-chat route). */
  disabled?: boolean
  /** Product surface that will own the newly created primary-agent thread. */
  surface?: 'code' | 'write' | 'design'
}

export function FloatingComposerAgentPicker({ compact = false, disabled, surface = 'code' }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const composerAgentId = useChatStore((s) => s.composerAgentId)
  const setComposerAgentId = useChatStore((s) => s.setComposerAgentId)
  const [agents, setAgents] = useState<KunSubagentProfileV1[]>([])
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const loadedRef = useRef(false)

  const loadAgents = useCallback(async (force = false): Promise<void> => {
    try {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: force })
      const profiles = settings.agents?.kun?.subagents?.profiles ?? []
      setAgents(profiles.filter((profile) => primaryAgentAvailableOnSurface(profile, surface)))
      loadedRef.current = true
    } catch {
      /* swallow — picker just won't show entries */
    }
  }, [surface])

  useEffect(() => { void loadAgents() }, [loadAgents])

  // Reload when the menu opens to pick up edits made in SubagentsView
  // mid-session. Force a refresh so a just-created agent shows immediately
  // rather than waiting out the settings cache.
  useEffect(() => {
    if (open && loadedRef.current) void loadAgents(true)
  }, [open, loadAgents])

  const closeMenu = useCallback((): void => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: closeMenu,
    preferredWidth: MENU_WIDTH,
    estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  const active = agents.find((profile) => profile.id === composerAgentId)

  // Don't render the picker when no primary-capable agent exists — it
  // would just be dead UI clutter.
  if (agents.length === 0) return null

  const clearAgent = (): void => {
    setComposerAgentId('')
    setOpen(false)
  }
  const pickAgent = (id: string): void => {
    setComposerAgentId(id)
    setOpen(false)
  }

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t('agentPicker.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      data-agent-picker-menu
      className="ds-composer-agent-menu ds-no-drag fixed z-50 overflow-hidden rounded-lg border border-ds-border bg-ds-main shadow-xl"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ds-faint">{t('agentPicker.title')}</div>
      <button
        type="button"
        onClick={clearAgent}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ds-hover ${!composerAgentId ? 'bg-ds-subtle' : ''}`}
      >
        <Bot className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <span className="flex-1 text-ds-ink">{t('agentPicker.runtimeDefault')}</span>
      </button>
      {agents.length === 0 ? (
        <p className="px-3 py-2 text-xs text-ds-muted">{t('agentPicker.empty')}</p>
      ) : null}
      {agents.map((profile) => (
        <button
          key={profile.id}
          type="button"
          onClick={() => pickAgent(profile.id)}
          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-ds-hover ${composerAgentId === profile.id ? 'bg-ds-subtle' : ''}`}
        >
          <span
            className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: profile.color ?? '#3b82f6' }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ds-ink">{profile.name}</span>
            {profile.description ? (
              <span className="block truncate text-xs text-ds-muted">{profile.description}</span>
            ) : null}
            <span className="block text-[10px] text-ds-faint">
              {profile.providerId ? `${profile.providerId}:` : ''}{profile.model ?? 'inherit'}
            </span>
          </span>
        </button>
      ))}
      <div className="border-t border-ds-border px-3 py-2 text-[11px] text-ds-faint">
        {t('agentPicker.nextChatHint')}
      </div>
    </div>
  ) : null

  return (
    <>
      <div className="ds-composer-agent-picker ds-no-drag relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={open}
          onClick={() => setOpen((s) => !s)}
          className={`flex h-7 items-center gap-1 rounded-full border border-ds-border bg-ds-raised px-2 text-xs text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'text-ds-ink' : ''}`}
          title={active
            ? t('agentPicker.activeTitle', { name: active.name })
            : t('agentPicker.pickTitle')}
        >
          {active?.color ? (
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: active.color }} />
          ) : (
            <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {!compact ? (
            <span className="max-w-[120px] truncate">{active ? active.name : t('agentPicker.default')}</span>
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.75} />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
