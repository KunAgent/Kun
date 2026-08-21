import type { ScheduledTaskV1 } from '@shared/app-settings'

export type PlanScheduleCountdown =
  | { kind: 'due' }
  | { kind: 'remaining'; days: number; hours: number; minutes: number }

export function scheduledTaskTime(task: ScheduledTaskV1): string {
  const next = Date.parse(task.nextRunAt)
  if (Number.isFinite(next)) return task.nextRunAt
  return Number.isFinite(Date.parse(task.schedule.atTime)) ? task.schedule.atTime : ''
}

export function activePlanScheduledTask(
  tasks: readonly ScheduledTaskV1[],
  planId: string,
  nowMs = Date.now()
): ScheduledTaskV1 | null {
  return tasks
    .filter((task) => task.sourcePlanId === planId && task.enabled && task.schedule.kind === 'at')
    .filter((task) => {
      const time = scheduledTaskTime(task)
      return Boolean(time) && Date.parse(time) > nowMs
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
}

export function formatPlanScheduleNextRun(
  atTime: string,
  timeZone: string,
  locale?: string,
  nowMs = Date.now()
): string {
  const targetMs = Date.parse(atTime)
  if (!Number.isFinite(targetMs)) return ''

  const calendarParts = (instantMs: number): [number, number, number] => {
    const values = new Map(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      }).formatToParts(new Date(instantMs)).map((part) => [part.type, Number(part.value)])
    )
    return [values.get('year') ?? 0, values.get('month') ?? 0, values.get('day') ?? 0]
  }

  const [targetYear, targetMonth, targetDay] = calendarParts(targetMs)
  const [todayYear, todayMonth, todayDay] = calendarParts(nowMs)
  const calendarDayDifference = Math.round((
    Date.UTC(targetYear, targetMonth - 1, targetDay) -
    Date.UTC(todayYear, todayMonth - 1, todayDay)
  ) / 86_400_000)
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(targetMs))

  if (calendarDayDifference === 0 || calendarDayDifference === 1) {
    const day = new Intl.RelativeTimeFormat(locale ?? 'en', { numeric: 'auto' })
      .format(calendarDayDifference, 'day')
    return `${day} ${time}`
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(targetMs))
}

export function planScheduleCountdown(atTime: string, nowMs = Date.now()): PlanScheduleCountdown {
  const target = Date.parse(atTime)
  if (!Number.isFinite(target) || target <= nowMs) return { kind: 'due' }
  const totalMinutes = Math.ceil((target - nowMs) / 60_000)
  return {
    kind: 'remaining',
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60
  }
}
