import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, BellRing, Pause, Play } from 'lucide-react'
import type { Room, RoomReminderEntry } from '@shared/rooms-api'
import { useAgentResource } from './agent-client'
import { roomsClient, roomPath } from './rooms-client'
import './rooms-reminders.css'

const formatTime = (iso: string, timezone?: string) => new Date(iso).toLocaleString([], {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone
})

function ReminderRow({ reminder, busy, onCancel, onPause }: {
  reminder: RoomReminderEntry
  busy: boolean
  onCancel: (reminder: RoomReminderEntry) => void
  onPause: (reminder: RoomReminderEntry) => void
}) {
  const { t } = useTranslation('common')
  const scheduled = reminder.status === 'scheduled'
  const active = scheduled || reminder.status === 'paused'
  const recurrence = reminder.recurrence
  return <article className={`rooms-reminder is-${reminder.status}`}>
    <p className="rooms-reminder-note">{reminder.note}</p>
    <div className="rooms-reminder-meta">
      <span>{reminder.timezone ?? 'UTC'}</span>
      {recurrence ? <span>{t('roomsReminderRecurrence_' + recurrence.kind, {
        seconds: recurrence.kind === 'interval' ? recurrence.everySeconds : undefined,
        time: recurrence.kind !== 'interval' ? recurrence.localTime : undefined
      })}{recurrence.kind === 'weekly' ? ` (${recurrence.weekdays.map((day) =>
        t('roomsReminderWeekday_' + day)).join(', ')})` : ''}</span> : null}
      {reminder.trigger ? <span>{t('roomsReminderTrigger_' + reminder.trigger.kind, {
        seconds: reminder.trigger.kind === 'room_idle' ? reminder.trigger.idleSeconds : undefined
      })}</span> : null}
      {reminder.quietHours ? <span>{t('roomsReminderQuietHours', reminder.quietHours)}</span> : null}
      {reminder.deferredReason ? <span>{t('roomsReminderDeferred_' + reminder.deferredReason)}</span> : null}
    </div>
    <div className="rooms-reminder-meta">
      <span className={`rooms-reminder-status is-${reminder.status}`}>
        {t('roomsReminderStatus_' + reminder.status)}
      </span>
      <time dateTime={scheduled ? reminder.fireAt : reminder.updatedAt}
        title={new Date(scheduled ? reminder.fireAt : reminder.updatedAt).toLocaleString()}>
        {scheduled
          ? t('roomsReminderFireAt', { time: formatTime(reminder.fireAt, reminder.timezone) })
          : reminder.endedReason
            ? t('roomsReminderReason_' + reminder.endedReason)
            : formatTime(reminder.updatedAt)}
      </time>
      {active ? <button type="button" className="rooms-reminder-cancel" disabled={busy}
        onClick={() => onPause(reminder)}>{scheduled ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        {t(scheduled ? 'roomsReminderPause' : 'roomsReminderResume')}</button> : null}
      {active ? <button type="button" className="rooms-reminder-cancel" disabled={busy}
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
  const mutationPending = useRef(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const reminders = resource.data?.reminders ?? []
  const scheduled = reminders.filter((reminder) => ['scheduled', 'paused'].includes(reminder.status))
  const ended = reminders.filter((reminder) => !['scheduled', 'paused'].includes(reminder.status))
  const mutate = async (reminder: RoomReminderEntry, action: 'cancel' | 'pause') => {
    if (mutationPending.current) return
    mutationPending.current = true
    setBusyId(reminder.reminderId)
    setError('')
    try {
      if (action === 'cancel') await roomsClient.cancelRoomReminder(room.id, reminder)
      else await roomsClient.setRoomReminderPaused(room.id, reminder, reminder.status === 'scheduled')
      resource.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      mutationPending.current = false
      setBusyId('')
    }
  }
  return <div className="rooms-reminder-list min-h-0 flex-1 overflow-y-auto">
    {scheduled.length ? <section className="rooms-reminder-section" aria-label={t('roomsReminderScheduled')}>
      <h3><BellRing size={14} aria-hidden="true" />{t('roomsReminderScheduled')}</h3>
      {scheduled.map((reminder) => <ReminderRow key={reminder.reminderId} reminder={reminder}
        busy={busyId !== ''} onCancel={(value) => void mutate(value, 'cancel')}
        onPause={(value) => void mutate(value, 'pause')} />)}
    </section> : null}
    {ended.length ? <section className="rooms-reminder-section" aria-label={t('roomsReminderRecent')}>
      <h3>{t('roomsReminderRecent')}</h3>
      {ended.map((reminder) => <ReminderRow key={reminder.reminderId} reminder={reminder}
        busy={busyId !== ''} onCancel={(value) => void mutate(value, 'cancel')}
        onPause={(value) => void mutate(value, 'pause')} />)}
    </section> : null}
    {!resource.data && !resource.error ? <p className="rooms-reminder-empty">{t('roomsReminderLoading')}</p> : null}
    {resource.data && !reminders.length ? <p className="rooms-reminder-empty">{t('roomsReminderEmpty')}</p> : null}
    {error || resource.error ? <p role="alert" className="rooms-run-error">{error || resource.error}</p> : null}
  </div>
}
