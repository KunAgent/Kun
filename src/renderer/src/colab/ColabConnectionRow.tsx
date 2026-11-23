import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ColabConnectionView } from '@shared/colab/colab-types'
import { normalizeColabWorkspaceKey } from './colab-store'
import { useColabDismiss } from './use-colab-dismiss'

type MenuPosition = { top: number; right: number; up: boolean }

const MENU_ESTIMATED_HEIGHT = 230

type Props = {
  conn: ColabConnectionView
  wsKey: string
  selected: boolean
  selectable?: boolean
  focusable: boolean
  isNew: boolean
  highlighted: boolean
  registerRef: (el: HTMLDivElement | null) => void
  onActivate: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  onFocus: () => void
  onReauth: () => void
  onRequestSignOut: () => void
}

export function ColabConnectionRow({
  conn,
  wsKey,
  selected,
  selectable = true,
  focusable,
  isNew,
  highlighted,
  registerRef,
  onActivate,
  onKeyDown,
  onFocus,
  onReauth,
  onRequestSignOut
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const rowRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const renameSettledRef = useRef(false)
  const expired = conn.status === 'expired'

  const closeMenu = useCallback(() => setMenuPos(null), [])
  useColabDismiss(menuPos !== null, closeMenu, menuRef)

  useEffect(() => {
    if (!menuPos) return
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menuPos, closeMenu])

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlighted])

  const localOcc = conn.activeSessions.filter(
    (o) => normalizeColabWorkspaceKey(o.workspaceRoot) === wsKey
  )
  const remoteOcc = conn.activeSessions.find(
    (o) => normalizeColabWorkspaceKey(o.workspaceRoot) !== wsKey
  )

  const startRename = (): void => {
    renameSettledRef.current = false
    setRenameDraft(conn.name)
    setRenaming(true)
  }

  // Enter and blur can both fire for one edit; settle exactly once.
  const settleRename = (save: boolean): void => {
    if (renameSettledRef.current) return
    renameSettledRef.current = true
    const name = renameDraft.trim()
    if (save && name && name !== conn.name) {
      void window.kunGui.colabRenameConnection({ connectionId: conn.id, name })
    }
    setRenaming(false)
    rowRef.current?.focus()
  }

  const toggleMenu = (button: HTMLElement): void => {
    if (menuPos) {
      setMenuPos(null)
      return
    }
    const rect = button.getBoundingClientRect()
    const up = window.innerHeight - rect.bottom < MENU_ESTIMATED_HEIGHT
    setMenuPos({
      top: up ? rect.top - 4 : rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
      up
    })
  }

  const menuItem = 'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover'
  const runMenu = (action: () => void) => () => {
    setMenuPos(null)
    action()
  }

  return (
    <div
      ref={(el) => {
        rowRef.current = el
        registerRef(el)
      }}
      role={selectable ? 'radio' : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-disabled={selectable && expired ? true : undefined}
      tabIndex={selectable ? (focusable ? 0 : -1) : undefined}
      onKeyDown={selectable ? (e) => {
        if (!renaming && e.target === e.currentTarget) onKeyDown(e)
      } : undefined}
      onFocus={selectable ? onFocus : undefined}
      onClick={selectable ? () => {
        if (!renaming) onActivate()
      } : undefined}
      className={`relative rounded-xl border p-2.5 text-[12px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50 ${
        expired || !selectable ? 'cursor-default' : 'cursor-pointer'
      } ${
        selected
          ? 'border-accent/55 bg-accent/[0.06]'
          : 'border-ds-border-muted bg-ds-card hover:border-ds-border'
      } ${highlighted ? 'ring-2 ring-emerald-500/50' : ''}`}
    >
      <div className="flex items-center gap-2">
        {selectable ? (
          <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-accent' : expired ? 'border-ds-border-muted' : 'border-ds-faint'
          }`}>
            {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
          </span>
        ) : null}
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white ${
            expired ? 'opacity-50' : ''
          }`}
          style={{ backgroundColor: conn.avatarColor }}
        >
          {conn.name.slice(0, 1).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              type="text"
              value={renameDraft}
              autoFocus
              maxLength={48}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => settleRename(true)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') settleRename(true)
                else if (e.key === 'Escape') settleRename(false)
              }}
              className="w-full rounded border border-accent bg-ds-subtle px-1.5 py-0.5 text-[12px] text-ds-ink focus:outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate font-semibold ${expired ? 'text-ds-muted' : 'text-ds-ink'}`}>
                {conn.name}
              </span>
              {isNew ? (
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-300">
                  {t('colab.newBadge')}
                </span>
              ) : null}
            </div>
          )}
          <div className="truncate text-[11px] text-ds-faint">
            {expired ? `${conn.email} · ${t('colab.expiredBadge')}` : `${conn.email} · ${conn.planLabel}`}
          </div>
        </div>

        {expired ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReauth()
            }}
            className="shrink-0 whitespace-nowrap rounded-md bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
          >
            {t('colab.reauthorize')}
          </button>
        ) : conn.balanceCu !== null ? (
          <span className="shrink-0 font-mono text-[11.5px] font-medium text-ds-ink">
            {conn.balanceCu} CU
          </span>
        ) : null}

        <button
          type="button"
          aria-label={conn.name}
          aria-haspopup="menu"
          aria-expanded={menuPos !== null}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            toggleMenu(e.currentTarget)
          }}
          className="shrink-0 rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {localOcc.length > 0 || remoteOcc ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 pl-6 text-[10.5px] text-ds-muted">
          <span className="truncate">
            {localOcc.length > 0
              ? t('colab.thisWorkspaceSessions', { total: localOcc.length })
              : t('colab.otherWorkspaceUsing', { workspace: remoteOcc?.workspaceLabel ?? '' })}
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
            {t('colab.phaseRunning')}
          </span>
        </div>
      ) : null}

      {menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                right: menuPos.right,
                ...(menuPos.up
                  ? { bottom: window.innerHeight - menuPos.top }
                  : { top: menuPos.top })
              }}
              className="ds-no-drag z-[90] w-48 rounded-lg border border-ds-border bg-ds-elevated py-1 text-[11.5px] shadow-lg"
            >
              {!selected && !expired ? (
                <button type="button" role="menuitem" onClick={runMenu(onActivate)} className={menuItem}>
                  {t('colab.menuSetCurrent')}
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={runMenu(startRename)} className={menuItem}>
                {t('colab.menuRename')}
              </button>
              {!expired ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={runMenu(() => void window.kunGui.colabRefreshBalances({ connectionId: conn.id }))}
                  className={menuItem}
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{t('colab.menuRefreshBalance')}</span>
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={runMenu(onReauth)} className={menuItem}>
                {t('colab.reauthorize')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={runMenu(() => void window.kunGui.colabOpenBrowser({ connectionId: conn.id }))}
                className={menuItem}
              >
                <ExternalLink className="h-3 w-3" />
                <span>{t('colab.menuOpenColab')}</span>
              </button>
              <div className="my-1 border-t border-ds-border-muted" />
              <button
                type="button"
                role="menuitem"
                onClick={runMenu(onRequestSignOut)}
                className="flex w-full items-center px-3 py-1.5 text-left text-red-500 hover:bg-red-500/10"
              >
                {t('colab.menuSignOut')}
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
