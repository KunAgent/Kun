import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Archive, PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type WriteResourceConversationAction = 'rename' | 'archive'

export type AnchorRect = Pick<DOMRect, 'left' | 'right' | 'bottom' | 'top'>

type Props = {
  anchorRect: AnchorRect
  canRename: boolean
  canArchive: boolean
  onSelect: (action: WriteResourceConversationAction) => void
  onClose: (restoreFocus: boolean) => void
  onOutsidePointer: (target: Node | null) => void
  registerContainer: (element: HTMLDivElement | null) => void
}

const VIEWPORT_MARGIN = 8
const MENU_GAP = 6
const MENU_MIN_WIDTH = 136

function getMenuMountPoint(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.body
}

export function WriteResourceConversationActionsMenu({
  anchorRect,
  canRename,
  canArchive,
  onSelect,
  onClose,
  onOutsidePointer,
  registerContainer
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const mountPoint = getMenuMountPoint()

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const menuWidth = Math.max(menu.offsetWidth, MENU_MIN_WIDTH)
    const menuHeight = menu.offsetHeight
    const left = Math.min(
      Math.max(anchorRect.right - menuWidth, VIEWPORT_MARGIN),
      window.innerWidth - menuWidth - VIEWPORT_MARGIN
    )
    const spaceBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_MARGIN
    const spaceAbove = anchorRect.top - VIEWPORT_MARGIN
    const above = spaceBelow < menuHeight + MENU_GAP && spaceAbove > spaceBelow
    const maxHeight = Math.max(spaceBelow, spaceAbove) - MENU_GAP
    menu.style.maxHeight = `${Math.max(maxHeight, 96)}px`
    const resolvedHeight = Math.min(menuHeight, Math.max(maxHeight, 96))
    const top = above
      ? Math.max(anchorRect.top - MENU_GAP - resolvedHeight, VIEWPORT_MARGIN)
      : anchorRect.bottom + MENU_GAP
    setPosition({ left, top, above })
  }, [anchorRect])

  useEffect(() => {
    if (!mountPoint) return
    const handlePointerDown = (event: MouseEvent): void => {
      onOutsidePointer(event.target as Node | null)
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose(true)
      }
    }
    const handleViewportChange = (): void => onClose(false)
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleEscape, true)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [mountPoint, onClose, onOutsidePointer])

  useEffect(() => {
    registerContainer(menuRef.current)
    return () => registerContainer(null)
  }, [registerContainer])

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('writeConversationMore')}
      className="fixed z-[90] min-w-[136px] overflow-y-auto rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-[0_12px_36px_rgba(20,47,95,0.2)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.42)]"
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!canRename}
        onClick={() => onSelect('rename')}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
      >
        <PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('sidebarThreadRename')}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canArchive}
        onClick={() => onSelect('archive')}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-300"
      >
        <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('sidebarThreadArchive')}
      </button>
    </div>
  )

  if (!mountPoint) return menu

  return createPortal(menu, mountPoint)
}
