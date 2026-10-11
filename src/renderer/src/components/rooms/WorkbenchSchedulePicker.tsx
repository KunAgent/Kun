import type { WorkbenchSchedule } from '@shared/rooms-api'
import { useTranslation } from 'react-i18next'

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const localDateTime = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const nextHour = () => new Date(Date.now() + 60 * 60_000).toISOString()

export function WorkbenchSchedulePicker({ schedule, onChange }: {
  schedule?: WorkbenchSchedule
  onChange: (schedule?: WorkbenchSchedule) => void
}) {
  const { t } = useTranslation('common')
  const mode = schedule?.kind ?? 'now'
  const recurring = schedule?.kind === 'recurring' ? schedule : undefined
  const setKind = (value: string) =>
    onChange(value === 'once' ? { kind: 'once', runAt: nextHour(), timeZone: zone() } :
      value === 'recurring' ? { kind: 'recurring', every: 'day', time: '09:00', timeZone: zone() } : undefined)
  return <div className="rooms-workbench-schedule">
    <div className="rooms-workbench-schedule-kind"><span>{t('roomsWorkbenchExecutionTime')}</span>
      <div className="rooms-workbench-segments" role="group">
        <button type="button" aria-pressed={mode === 'now'} onClick={() => setKind('now')}>{t('roomsWorkbenchNow')}</button>
        <button type="button" aria-pressed={mode === 'once'} onClick={() => setKind('once')}>{t('roomsWorkbenchOnce')}</button>
        <button type="button" aria-pressed={mode === 'recurring'} onClick={() => setKind('recurring')}>{t('roomsWorkbenchRecurring')}</button>
      </div></div>
    {schedule?.kind === 'once' ? <>
      <label>{t('roomsWorkbenchRunAt')}<input type="datetime-local" value={localDateTime(schedule.runAt)}
        min={localDateTime(new Date(Date.now() + 60_000).toISOString())}
        max={localDateTime(new Date(Date.now() + 30 * 86_400_000).toISOString())} onChange={(event) => {
        const date = new Date(event.target.value)
        if (!Number.isNaN(date.getTime())) onChange({ ...schedule, runAt: date.toISOString() })
      }} /></label>
      <div className="rooms-workbench-schedule-shortcuts">
        {[[t('roomsWorkbenchIn30Minutes'), 30], [t('roomsWorkbenchTonight'), -2],
          [t('roomsWorkbenchTomorrowMorning'), -1]].map(([label, minutes]) => <button key={label} type="button" onClick={() => {
          const date = Number(minutes) < 0 ? new Date() : new Date(Date.now() + Number(minutes) * 60_000)
          if (minutes === -1) { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0) }
          if (minutes === -2) {
            date.setHours(20, 0, 0, 0)
            if (date.getTime() <= Date.now() + 60_000) date.setDate(date.getDate() + 1)
          }
          onChange({ ...schedule, runAt: date.toISOString() })
        }}>{label}</button>)}
      </div>
    </> : null}
    {recurring ? <>
      <label>{t('roomsWorkbenchFrequency')}<select value={recurring.every} onChange={(event) => onChange({ ...recurring,
        every: event.target.value as 'day' | 'weekday' | 'week',
        ...(event.target.value === 'week' ? { weekdays: recurring.weekdays?.length ? recurring.weekdays : [1] } : { weekdays: undefined }) })}>
        <option value="day">{t('roomsWorkbenchEveryDay')}</option><option value="weekday">{t('roomsWorkbenchWeekdays')}</option><option value="week">{t('roomsWorkbenchEveryWeek')}</option>
      </select></label>
      {recurring.every === 'week' ? <fieldset className="rooms-workbench-weekdays"><legend>{t('roomsWorkbenchWeekday')}</legend>
        {[0, 1, 2, 3, 4, 5, 6].map((index) => <label key={index}>
          <input type="checkbox" checked={recurring.weekdays?.includes(index) ?? false} onChange={(event) => onChange({ ...recurring,
            weekdays: event.target.checked ? [...(recurring.weekdays ?? []), index].sort() : (recurring.weekdays ?? []).filter((value) => value !== index) })} />{t(`roomsWorkbenchDay_${index}`)}</label>)}
      </fieldset> : null}
      <label>{t('roomsWorkbenchRunAt')}<input type="time" value={recurring.time} onChange={(event) => onChange({ ...recurring, time: event.target.value })} /></label>
      <label>{t('roomsWorkbenchEndCondition')}<select value={recurring.maxRuns ? 'runs' : recurring.endsAt ? 'date' : 'never'} onChange={(event) => onChange({ ...recurring,
        maxRuns: event.target.value === 'runs' ? 10 : undefined,
        endsAt: event.target.value === 'date' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : undefined })}>
        <option value="never">{t('roomsWorkbenchNever')}</option><option value="date">{t('roomsWorkbenchUntilDate')}</option><option value="runs">{t('roomsWorkbenchRunCount')}</option>
      </select></label>
      {recurring.endsAt ? <label>{t('roomsWorkbenchEndDate')}<input type="date" value={localDateTime(recurring.endsAt).slice(0, 10)} onChange={(event) => {
        const date = new Date(`${event.target.value}T23:59`)
        if (!Number.isNaN(date.getTime())) onChange({ ...recurring, endsAt: date.toISOString() })
      }} /></label> : null}
      {recurring.maxRuns ? <label>{t('roomsWorkbenchMaxRuns')}<input type="number" min={1} max={1000} value={recurring.maxRuns}
        onChange={(event) => onChange({ ...recurring, maxRuns: Number(event.target.value) })} /></label> : null}
    </> : null}
    {schedule ? <p className="rooms-workbench-note">{t('roomsWorkbenchScheduleHint')}</p> : null}
  </div>
}
