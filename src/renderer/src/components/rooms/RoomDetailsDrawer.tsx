import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { roomButtonClass } from './RoomSettings'

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
  children
}: {
  section: RoomDetailsSection
  onSection: (section: RoomDetailsSection) => void
  onClose: () => void
  taskOpen: boolean
  onBack: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('common')
  const panel = useRef<HTMLElement>(null)
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
      className="absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden border-l border-ds-border bg-ds-main shadow-xl xl:static xl:w-[400px] xl:shrink-0 xl:shadow-none"
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
        )
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
      <header className="rooms-detail-titlebar flex items-center gap-2 border-b border-ds-border p-4">
        {taskOpen ? (
          <button
            className={roomButtonClass}
            aria-label={t('roomsBackToTasks')}
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ds-ink">
          {t(taskOpen ? 'roomsDetails' : 'roomsRoomDetails')}
        </h2>
        <button
          className={roomButtonClass}
          onClick={onClose}
          aria-label={t('roomsClose')}
        >
          <X size={16} />
        </button>
      </header>
      {!taskOpen ? (
        <nav
          aria-label={t('roomsRoomDetails')}
          className="flex shrink-0 flex-wrap gap-1 border-b border-ds-border p-2"
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
        className={`min-h-0 flex-1 ${taskOpen ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
      >
        {children}
      </div>
    </aside>
  )
}
