import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { CalendarClock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatInTimeZone,
  relativeScheduleLabel,
  supportedTimeZones,
  systemTimeZone,
  zonedDateTimeToIso,
  type ZonedDateTimeResult
} from '@shared/app-settings'
import { defaultScheduleDraft } from '../plan/PlanScheduledBuildDialog'

export type ScheduledSendDraft = {
  atTime: string
  timeZone: string
}

type Props = {
  submitting: boolean
  error: string
  onClose: () => void
  onSubmit: (draft: ScheduledSendDraft) => Promise<void>
}

const SCHEDULE_INSTANT_ERROR_KEYS = {
  'invalid-date': 'planScheduleBuildErrorInvalidDate',
  'invalid-time-zone': 'planScheduleBuildErrorInvalidTimeZone',
  'nonexistent-time': 'planScheduleBuildErrorNonexistentTime',
  'ambiguous-time': 'planScheduleBuildErrorAmbiguousTime',
  'past-time': 'planScheduleBuildErrorPastTime'
} as const

function instantError(
  instant: Extract<ZonedDateTimeResult, { ok: false }>,
  t: (key: string) => string
): string {
  return t(SCHEDULE_INSTANT_ERROR_KEYS[instant.code])
}

export function ScheduledSendDialog({ submitting, error, onClose, onSubmit }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage ?? i18n.language
  const initial = useMemo(() => defaultScheduleDraft(), [])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [timeZone, setTimeZone] = useState(systemTimeZone())
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dateRef = useRef<HTMLInputElement | null>(null)
  const instant = zonedDateTimeToIso(date, time, timeZone)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dateRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!submitting) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>([
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])'
    ].join(',')) ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const submit = (): void => {
    if (!instant.ok) return
    void onSubmit({ atTime: instant.iso, timeZone })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-4" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-busy={submitting} aria-label={t('planScheduleBuildSet')} onKeyDown={onDialogKeyDown} className="w-full max-w-[480px] rounded-[24px] border border-ds-border bg-ds-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-ds-ink">{t('planScheduleBuildSet')}</h2>
            <p className="mt-1 text-[12px] text-ds-muted">{t('planScheduleBuildAutomaticHint')}</p>
          </div>
          <button type="button" disabled={submitting} onClick={onClose} aria-label={t('close')} className="rounded-full p-2 text-ds-muted hover:bg-ds-hover disabled:opacity-45"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <label className="text-[12px] text-ds-muted">{t('planScheduleBuildDate')}<input ref={dateRef} data-scheduled-send-date disabled={submitting} className="mt-1.5 h-10 w-full rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-accent disabled:opacity-60" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="text-[12px] text-ds-muted">{t('planScheduleBuildTime')}<input data-scheduled-send-time disabled={submitting} className="mt-1.5 h-10 w-full rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-accent disabled:opacity-60" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <label className="col-span-2 text-[12px] text-ds-muted">{t('planScheduleBuildTimeZone')}<select data-scheduled-send-time-zone disabled={submitting} className="mt-1.5 h-10 w-full rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-accent disabled:opacity-60" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        </div>
        {instant.ok ? <p className="mt-3 text-[11.5px] text-ds-muted">{formatInTimeZone(instant.iso, timeZone, locale)} · {relativeScheduleLabel(instant.iso, Date.now(), locale)}</p> : <p className="mt-3 text-[12px] text-red-600" role="alert">{instantError(instant, t)}</p>}
        {error ? <p className="mt-4 text-[12px] text-red-600" role="alert">{error}</p> : null}
        <p className="mt-4 text-[11.5px] leading-5 text-ds-muted">{t('planScheduleBuildRunningNotice')}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={submitting} onClick={onClose} className="h-10 rounded-full px-4 text-[13px] text-ds-muted hover:bg-ds-hover disabled:opacity-45">{t('cancel')}</button><button data-scheduled-send-confirm type="button" disabled={submitting || !instant.ok} onClick={submit} className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-[13px] font-medium text-white disabled:opacity-45"><CalendarClock className="h-4 w-4" />{submitting ? t('planScheduleBuildConfirmPending') : t('planScheduleBuildConfirm')}</button></div>
      </div>
    </div>
  )
}
