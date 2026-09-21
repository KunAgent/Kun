import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, PanelRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { roomButtonClass } from './RoomSettings'
import { RoomPanelResizeHandle } from './RoomPanelResizeHandle'

export type RoomDetailsSection = 'discussion' | 'tasks' | 'overview' | 'members'
const labels: Record<RoomDetailsSection, string> = {
  discussion: 'roomsDiscussionActivity',
  tasks: 'roomsTasks',
  overview: 'roomsOverview',
  members: 'roomsMembers'
}

export function RoomDetailsDrawer({
  section,
  onSection,
  onClose,
  taskOpen,
  onBack,
  runOpen = false,
  childOpen = false,
  title,
  backLabel,
  children
}: {
  section: RoomDetailsSection
  onSection: (section: RoomDetailsSection) => void
  onClose: () => void
  taskOpen: boolean
  onBack: () => void
  runOpen?: boolean
  childOpen?: boolean
  title?: string
  backLabel?: string
  children: ReactNode
}) {
  const { t } = useTranslation('common')
  const panel = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const sideDocked = runOpen && !expanded
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = panel.current
    element?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (previous?.isConnected && (element?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus()
    }
  }, [])
  return (
    <aside
      ref={panel}
      role="dialog"
      aria-label={t('roomsRoomDetails')}
      className={`rooms-details-panel absolute ${sideDocked ? 'inset-y-0 right-0 w-[min(560px,100%)]' : 'inset-0'} z-50 flex min-h-0 flex-col overflow-hidden border-l border-ds-border bg-ds-main shadow-xl xl:static xl:w-[400px] xl:shrink-0 xl:shadow-none`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
        if (
          event.key !== 'Tab' ||
          !window.matchMedia?.('(max-width: 1279px)').matches
        )
          return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
          )
        ).filter((control) => !control.closest('[inert]'))
        const first = controls[0],
          last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <RoomPanelResizeHandle side="detail" />
      <header className="rooms-detail-titlebar flex items-center gap-2 border-b border-ds-border p-4">
        {taskOpen || runOpen || childOpen ? (
          <button
            className={roomButtonClass}
            aria-label={backLabel ?? t(runOpen ? 'roomsRunBack' : 'roomsBackToTasks')}
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ds-ink">
          {title ?? t(runOpen ? 'roomsRunDetails' : taskOpen ? 'roomsDetails' : 'roomsRoomDetails')}
        </h2>
        {runOpen ? (
          <button
            type="button"
            className={`${roomButtonClass} xl:hidden`}
            aria-pressed={!expanded}
            aria-label={t('roomsRightSidebar')}
            title={t('roomsRightSidebar')}
            onClick={() => setExpanded((value) => !value)}
          >
            <PanelRight size={16} />
          </button>
        ) : null}
        <button
          className={roomButtonClass}
          onClick={onClose}
          aria-label={t('roomsClose')}
        >
          <X size={16} />
        </button>
      </header>
      {!taskOpen && !runOpen && !childOpen ? (
        <nav
          aria-label={t('roomsRoomDetails')}
          className="rooms-details-tabs shrink-0"
        >
          {(Object.keys(labels) as RoomDetailsSection[]).map((value) => (
            <button
              key={value}
              aria-current={section === value ? 'page' : undefined}
              onClick={() => onSection(value)}
              className={`rounded-lg px-2 py-2 text-xs ${section === value ? 'bg-accent/10 text-ds-ink' : 'text-ds-muted hover:bg-ds-hover'}`}
            >
              {t(labels[value])}
            </button>
          ))}
        </nav>
      ) : null}
      <div
        className="relative min-h-0 flex-1 flex flex-col overflow-hidden"
      >
        {children}
      </div>
    </aside>
  )
}
