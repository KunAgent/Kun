import { useCallback, useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpToLine, ChevronDown, ChevronUp, Copy, Ellipsis, Loader2, Pause } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useComposerPickerPopover } from './use-composer-picker-popover'
import css from './FloatingComposerQueuedMessages.module.css'

const MENU_WIDTH = 184
const MENU_ESTIMATED_HEIGHT = 84

/** Caption above the rows: how many are waiting and when they go out. */
export function QueueCaption({
  count,
  running,
  confirming,
  showDragHint
}: {
  count: number
  running: boolean
  /** A row is being handed to the runtime right now. */
  confirming: boolean
  showDragHint: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const label = confirming
    ? t('queuedMessagesConfirming', { count })
    : running
      ? t('composerQueue.caption', { count })
      : t('queuedMessagesTitle', { count })
  return (
    <div className={css.caption} data-queued-message-caption>
      <span className={css.captionText}>{label}</span>
      {showDragHint ? (
        <span className={css.captionHint} aria-hidden="true">{t('composerQueue.dragHint')}</span>
      ) : null}
    </div>
  )
}

/**
 * Replaces the caption after an interrupt parked the queue, so the one
 * action that matters, continuing, sits on top of the rows.
 */
export function QueuePausedCaption({
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
  return (
    <div className={`${css.caption} ${css.pausedCaption}`} data-queue-paused-banner role="status">
      <span className={css.pausedIcon} aria-hidden="true">
        <Pause size={13} strokeWidth={0} fill="currentColor" />
      </span>
      {/* Only the reason ellipsizes; the count always stays readable. */}
      <span className={css.pausedText}>
        <span className={`${css.captionText} ${css.pausedTitle}`}>{t('composerQueue.pausedTitle')}</span>
        <span className={css.pausedCount}>{t('composerQueue.pausedCount', { count })}</span>
      </span>
      {onResume ? (
        <button
          type="button"
          className={css.resumeButton}
          data-queue-resume
          title={running ? t('queueResumeBusy') : t('composerQueue.resumeHint')}
          disabled={running || busy}
          onClick={onResume}
        >
          {busy ? <Loader2 className={css.spinner} size={12} aria-hidden="true" /> : null}
          {t('composerQueue.resume')}
        </button>
      ) : null}
    </div>
  )
}

/**
 * "n more" disclosure under the first rows of a long queue. Keeps the
 * `data-queued-message-header` marker the queue smoke script drives.
 */
export function QueueExpander({
  hiddenCount,
  expanded,
  disabled,
  controls,
  onToggle
}: {
  hiddenCount: number
  expanded: boolean
  disabled: boolean
  controls: string
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      className={css.expander}
      data-queued-message-header
      aria-controls={controls}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className={css.lead} aria-hidden="true">
        {expanded
          ? <ChevronUp size={14} strokeWidth={1.8} />
          : <ChevronDown size={14} strokeWidth={1.8} />}
      </span>
      <span>
        {expanded ? t('composerQueue.showLess') : t('composerQueue.showMore', { count: hiddenCount })}
      </span>
    </button>
  )
}

export type QueueRowMenuItem = {
  key: 'move-top' | 'copy'
  label: string
  title?: string
  disabled?: boolean
  onSelect: () => void
}

const MENU_ICONS = {
  'move-top': ArrowUpToLine,
  copy: Copy
} as const

/** The per-row overflow menu; portaled so the scrolling list never clips it. */
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
        className={css.iconAction}
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
