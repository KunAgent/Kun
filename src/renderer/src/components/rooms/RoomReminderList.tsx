import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, BellRing } from 'lucide-react'
import type { Room, RoomReminderEntry } from '@shared/rooms-api'
import { useAgentResource } from './agent-client'
import { roomsClient, roomPath } from './rooms-client'
import './rooms-reminders.css'

const formatTime = (iso: string) => new Date(iso).toLocaleString([], {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
})

function ReminderRow({ reminder, busy, onCancel }: {
  reminder: RoomReminderEntry
  busy: boolean
  onCancel: (reminder: RoomReminderEntry) => void
}) {
  const { t } = useTranslation('common')
  const scheduled = reminder.status === 'scheduled'
  return <article className={`rooms-reminder is-${reminder.status}`}>
    <p className="rooms-reminder-note">{reminder.note}</p>
    <div className="rooms-reminder-meta">
      <span className={`rooms-reminder-status is-${reminder.status}`}>
        {t('roomsReminderStatus_' + reminder.status)}
      </span>
      <time dateTime={scheduled ? reminder.fireAt : reminder.updatedAt}
        title={new Date(scheduled ? reminder.fireAt : reminder.updatedAt).toLocaleString()}>
        {scheduled
          ? t('roomsReminderFireAt', { time: formatTime(reminder.fireAt) })
          : reminder.endedReason
            ? t('roomsReminderReason_' + reminder.endedReason)
            : formatTime(reminder.updatedAt)}
      </time>
      {scheduled ? <button type="button" className="rooms-reminder-cancel" disabled={busy}
        onClick={() => onCancel(reminder)}><BellOff size={13} aria-hidden="true" />{t('roomsReminderCancel')}</button> : null}
    </div>
  </article>
}

/**
 * Reminders the private agent scheduled for itself. Listing is room-scoped:
 * a user_agent conversation only ever exposes its own agent's reminders.
 */
export function RoomReminderList({ room, active }: { room: Room; active?: boolean }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<{ reminders: RoomReminderEntry[] }>(
    room.conversationKind === 'user_agent' ? `${roomPath(room.id)}/reminders?status=all` : null, active !== false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const reminders = resource.data?.reminders ?? []
  const scheduled = reminders.filter((reminder) => reminder.status === 'scheduled')
  const ended = reminders.filter((reminder) => reminder.status !== 'scheduled')
  const cancel = async (reminder: RoomReminderEntry) => {
    setBusyId(reminder.reminderId)
    setError('')
    try {
      await roomsClient.cancelRoomReminder(room.id, reminder)
      resource.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId('')
    }
  }
  return <div className="rooms-reminder-list min-h-0 flex-1 overflow-y-auto">
    {scheduled.length ? <section className="rooms-reminder-section" aria-label={t('roomsReminderScheduled')}>
      <h3><BellRing size={14} aria-hidden="true" />{t('roomsReminderScheduled')}</h3>
      {scheduled.map((reminder) => <ReminderRow key={reminder.reminderId} reminder={reminder}
        busy={busyId === reminder.reminderId} onCancel={(value) => void cancel(value)} />)}
    </section> : null}
    {ended.length ? <section className="rooms-reminder-section" aria-label={t('roomsReminderRecent')}>
      <h3>{t('roomsReminderRecent')}</h3>
      {ended.map((reminder) => <ReminderRow key={reminder.reminderId} reminder={reminder}
        busy={busyId === reminder.reminderId} onCancel={(value) => void cancel(value)} />)}
    </section> : null}
    {!resource.data && !resource.error ? <p className="rooms-reminder-empty">{t('roomsReminderLoading')}</p> : null}
    {resource.data && !reminders.length ? <p className="rooms-reminder-empty">{t('roomsReminderEmpty')}</p> : null}
    {error || resource.error ? <p role="alert" className="rooms-run-error">{error || resource.error}</p> : null}
  </div>
}
