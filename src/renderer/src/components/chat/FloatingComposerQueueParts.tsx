import { useCallback, useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpToLine, Copy, Loader2, Ellipsis, Pause, Pencil, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useComposerPickerPopover } from './use-composer-picker-popover'
import css from './FloatingComposerQueuedMessages.module.css'

const MENU_WIDTH = 184
const MENU_ESTIMATED_HEIGHT = 120

/**
 * Queue-level notice shown after an interrupt parked the queue. It replaces
 * the count header so the one action that matters, resuming, sits on top.
 */
export function QueuePausedBanner({
  count,
  running,
  busy,
  onResume
}: {
  count: number
  running: boolean
  busy: boolean
  onResume?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const resumeTitle = running ? t('queueResumeBusy') : t('queueResume')
  return (
    <div className={css.pausedBanner} data-queue-paused-banner role="status">
      <span className={css.pausedIcon} aria-hidden="true">
        <Pause size={12} strokeWidth={2.6} />
      </span>
      <span className={css.pausedText}>
        <span className={css.pausedTitle}>{t('queuePausedTitle')}</span>
        <span className={css.pausedDetail}>{t('queuePausedDetail', { count })}</span>
      </span>
      {onResume ? (
        <button
          type="button"
          className={css.resumeButton}
          data-queue-resume
          title={resumeTitle}
          disabled={running || busy}
          onClick={onResume}
        >
          {busy
            ? <Loader2 className={css.spinner} size={12} aria-hidden="true" />
            : <Play size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
          {t('queueResume')}
        </button>
      ) : null}
    </div>
  )
}

export type QueueRowMenuItem = {
  key: 'edit' | 'move-top' | 'copy'
  label: string
  title?: string
  disabled?: boolean
  onSelect: () => void
}

const MENU_ICONS = {
  edit: Pencil,
  'move-top': ArrowUpToLine,
  copy: Copy
} as const

/** The per-row overflow menu; portaled so the scrolling dock never clips it. */
export function QueueRowMoreMenu({
  label,
  disabled,
  items
}: {
  label: string
  disabled: boolean
  items: QueueRowMenuItem[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open, onClose: close, preferredWidth: MENU_WIDTH, estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)'
    ) ?? [])
    if (buttons.length === 0) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    buttons[(index + step + buttons.length) % buttons.length]?.focus()
  }

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={`${css.menu} ds-no-drag`}
      style={menuStyle}
      data-queued-message-menu
      onKeyDown={moveFocus}
    >
      {items.map((item) => {
        const Icon = MENU_ICONS[item.key]
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={css.menuItem}
            data-queued-message-action={item.key}
            aria-label={item.title ?? item.label}
            title={item.title ?? item.label}
            disabled={item.disabled}
            onClick={() => {
              setOpen(false)
              item.onSelect()
            }}
          >
            <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={css.action}
        data-queued-message-action="more"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
