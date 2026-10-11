import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Compass,
  FileText,
  GraduationCap,
  LibraryBig,
  Link2Off,
  Link2,
  Plus,
  Shapes,
  Telescope
} from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { workSessionDisplayTitle } from '../../write/work-sessions-model'
import { startWorkSession } from '../../write/work-session-actions'
import { useWorkContextStore } from '../../write/work-context-store'
import { RoomPopover } from '../rooms/RoomPopover'

export type WorkContextKind = 'file' | 'paper' | 'whiteboard' | 'library' | 'discover' | 'research'

export type WorkContextDescriptor = {
  kind: WorkContextKind
  /** Editor item key of the focused tab; removing the chip detaches it. */
  key: string
  label: string
  /** e.g. the reader page `p.12/34`. */
  detail?: string
  /** Sessions anchored to this item, most recent first. */
  sessionIds: string[]
}

function KindIcon({ kind }: { kind: WorkContextKind }): ReactElement {
  const props = { className: 'h-3.5 w-3.5 shrink-0', strokeWidth: 1.75, 'aria-hidden': true as const }
  if (kind === 'paper') return <GraduationCap {...props} />
  if (kind === 'whiteboard') return <Shapes {...props} />
  if (kind === 'library') return <LibraryBig {...props} />
  if (kind === 'discover') return <Compass {...props} />
  if (kind === 'research') return <Telescope {...props} />
  return <FileText {...props} />
}

const MAX_LISTED = 6

/**
 * What is open, shown above the composer as the current session's context.
 * Its menu lists the sessions about this item (switching is explicit), starts
 * a new one about it, or keeps it out of the next turns.
 */
export function WorkContextChip({ context, disabled = false }: {
  context: WorkContextDescriptor
  disabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const detached = useWorkContextStore((state) => state.detachedKey === context.key)
  const threads = useChatStore((state) => state.threads)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const sessions = context.sessionIds
    .map((id) => threads.find((thread) => thread.id === id))
    .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread && thread.archived !== true))
    .slice(0, MAX_LISTED)
  const canList = context.kind !== 'library' && context.kind !== 'discover' && context.kind !== 'research'

  return (
    <RoomPopover
      label={t('workContextMenu')}
      width={264}
      className={`work-context-chip${detached ? ' is-detached' : ''}`}
      trigger={(
        <>
          <KindIcon kind={context.kind} />
          <span className="work-context-chip-label" title={context.label}>{context.label}</span>
          {context.detail ? <span className="work-context-chip-detail">{context.detail}</span> : null}
          {detached ? <span className="work-context-chip-detail">{t('workContextDetached')}</span> : null}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2} aria-hidden />
        </>
      )}
    >
      {(close) => (
        <div className="rooms-menu-list work-context-menu" data-work-context-menu>
          {canList ? (
            <>
              <div className="work-space-menu-label">{t('workContextSessions')}</div>
              {sessions.length === 0 ? (
                <p className="work-context-menu-empty">{t('workContextNoSessions')}</p>
              ) : sessions.map((thread) => {
                const current = thread.id === activeThreadId
                return (
                  <button key={thread.id} type="button" aria-pressed={current} disabled={disabled && !current}
                    onClick={() => {
                      close()
                      if (!current) void useChatStore.getState().selectWriteThread(thread.id)
                    }}>
                    {current ? <Check size={15} aria-hidden="true" /> : <span className="work-space-menu-gap" />}
                    <span className="work-space-menu-name">{workSessionDisplayTitle(thread.title) || t('workSessionNew')}</span>
                  </button>
                )
              })}
              <button type="button" disabled={disabled} data-work-context-action="new"
                onClick={() => { close(); void startWorkSession() }}>
                <Plus size={15} aria-hidden="true" /><span>{t('workContextNewSession')}</span>
              </button>
              <hr />
            </>
          ) : null}
          <button type="button" data-work-context-action={detached ? 'attach' : 'detach'} onClick={() => {
            close()
            if (detached) useWorkContextStore.getState().attach()
            else useWorkContextStore.getState().detach(context.key)
          }}>
            {detached ? <Link2 size={15} aria-hidden="true" /> : <Link2Off size={15} aria-hidden="true" />}
            <span>{detached ? t('workContextAttach') : t('workContextDetach')}</span>
          </button>
        </div>
      )}
    </RoomPopover>
  )
}
