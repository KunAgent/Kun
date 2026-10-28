import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Columns2, Copy, FolderOpen, X } from 'lucide-react'

export type WorkTabMenuAction =
  | 'close' | 'closeOthers' | 'closeRight' | 'closeAll'
  | 'moveLeft' | 'moveRight' | 'openBeside'
  | 'copyPath' | 'reveal' | 'copyTitle'

/** What the right-clicked tab allows; a missing count or flag disables that row. */
export type WorkTabMenuState = {
  kind: 'session' | 'document'
  /** False for the draft session, which the strip always keeps. */
  canClose: boolean
  othersCount: number
  rightCount: number
  allCount: number
  canMoveLeft: boolean
  canMoveRight: boolean
  canOpenBeside: boolean
  /** Workspace-relative file path; whiteboards and paper views have none. */
  path: string | null
}

const ICON = { className: 'h-3.5 w-3.5 shrink-0', strokeWidth: 1.9, 'aria-hidden': true } as const

function Item({ action, icon, label, count, disabled, onClick }: {
  action: WorkTabMenuAction
  icon?: ReactNode
  label: string
  count?: number
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" role="menuitem" className="work-tab-menu-item" data-action={action} disabled={disabled} onClick={onClick}>
      {icon ?? <span className="work-tab-menu-spacer" aria-hidden="true" />}
      <span className="work-tab-menu-label">{label}</span>
      {count ? <span className="work-tab-menu-count">{count}</span> : null}
    </button>
  )
}

/**
 * Right-click menu of one Work strip tab. Drawn inside the strip at strip-local
 * coordinates (the body is zoomed, so the caller converts the pointer first).
 */
export function WorkTabContextMenu({ left, top, state, onAction, onDismiss }: {
  left: number
  top: number
  state: WorkTabMenuState
  onAction: (action: WorkTabMenuAction) => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (): void => onDismiss()
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [onDismiss])

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }
  const run = (action: WorkTabMenuAction) => () => onAction(action)

  return (
    <div ref={ref} className="work-tab-menu" role="menu" aria-label={t('workTabMenuLabel')} style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={moveFocus} onContextMenu={(event) => event.preventDefault()}>
      <Item action="close" icon={<X {...ICON} />} label={t('workTabMenuClose')} disabled={!state.canClose} onClick={run('close')} />
      <Item action="closeOthers" label={t('workTabMenuCloseOthers')} count={state.othersCount} disabled={!state.othersCount} onClick={run('closeOthers')} />
      <Item action="closeRight" label={t('workTabMenuCloseRight')} count={state.rightCount} disabled={!state.rightCount} onClick={run('closeRight')} />
      <Item action="closeAll" label={t('workTabMenuCloseAll')} count={state.allCount} disabled={!state.allCount} onClick={run('closeAll')} />
      <div className="work-tab-menu-separator" role="separator" />
      <Item action="moveLeft" icon={<ChevronLeft {...ICON} />} label={t('workTabMenuMoveLeft')} disabled={!state.canMoveLeft} onClick={run('moveLeft')} />
      <Item action="moveRight" icon={<ChevronRight {...ICON} />} label={t('workTabMenuMoveRight')} disabled={!state.canMoveRight} onClick={run('moveRight')} />
      {state.kind === 'document' ? (
        <Item action="openBeside" icon={<Columns2 {...ICON} />} label={t('workTabMenuOpenBeside')} disabled={!state.canOpenBeside} onClick={run('openBeside')} />
      ) : null}
      <div className="work-tab-menu-separator" role="separator" />
      {state.path ? (
        <>
          <Item action="copyPath" icon={<Copy {...ICON} />} label={t('workTabMenuCopyPath')} onClick={run('copyPath')} />
          <Item action="reveal" icon={<FolderOpen {...ICON} />} label={t('workTabMenuReveal')} onClick={run('reveal')} />
        </>
      ) : (
        <Item action="copyTitle" icon={<Copy {...ICON} />} label={t('workTabMenuCopyTitle')} onClick={run('copyTitle')} />
      )}
    </div>
  )
}
