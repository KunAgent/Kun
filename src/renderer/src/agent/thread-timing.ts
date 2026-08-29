export type RuntimeTurnRecord = {
  id: string
  status?: string
  createdAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  items?: RuntimeTurnItem[]
}

export type RuntimeTurnItem = {
  id: string
  kind: string
  createdAt?: string | null
  finishedAt?: string | null
}

export const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'aborted'])

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function itemStartedAtMs(item: RuntimeTurnItem): number | undefined {
  return parseTimestampMs(item.createdAt) ?? parseTimestampMs(item.finishedAt)
}

function itemFinishedAtMs(item: RuntimeTurnItem): number | undefined {
  return parseTimestampMs(item.finishedAt) ?? parseTimestampMs(item.createdAt)
}

function durationFromRange(startedAt: number | undefined, endedAt: number | undefined): number | undefined {
  if (typeof startedAt !== 'number' || typeof endedAt !== 'number') return undefined
  const duration = endedAt - startedAt
  return duration >= 0 && Number.isFinite(duration) ? duration : undefined
}

/**
 * Resolve the persisted start time of the turn currently running on a thread,
 * from the turns array of a thread detail response. Unlike the live
 * `turnStartedAtByUserId` (seeded from the user_message event), this survives
 * a thread switch or renderer restart, so elapsed-time displays anchored to it
 * do not reset when the conversation is re-opened mid-turn.
 */
export function resolveRunningTurnStartedAtMs(
  turns: readonly RuntimeTurnRecord[] | undefined
): number | undefined {
  if (!turns?.length) return undefined
  const running = turns.filter((turn) => !TERMINAL_TURN_STATUSES.has(turn.status ?? ''))
  const latest = running[running.length - 1]
  if (!latest) return undefined
  return parseTimestampMs(latest.startedAt) ?? parseTimestampMs(latest.createdAt)
}

export function buildTurnDurationByUserId(
  turns: readonly RuntimeTurnRecord[] | undefined
): Record<string, number> {
  if (!turns?.length) return {}

  const durations: Record<string, number> = {}
  for (const turn of turns) {
    const items = turn.items ?? []
    const userId = items.find((item) => item.kind === 'user_message')?.id
    if (!userId) continue
    const finishedAt = parseTimestampMs(turn.finishedAt)
    if (!TERMINAL_TURN_STATUSES.has(turn.status ?? '') && finishedAt === undefined) continue

    const firstItemStartedAt = items
      .map(itemStartedAtMs)
      .filter((ms): ms is number => typeof ms === 'number')
      .sort((a, b) => a - b)[0]
    const lastItemFinishedAt = items
      .map(itemFinishedAtMs)
      .filter((ms): ms is number => typeof ms === 'number')
      .sort((a, b) => b - a)[0]

    const duration = durationFromRange(
      parseTimestampMs(turn.startedAt) ?? parseTimestampMs(turn.createdAt) ?? firstItemStartedAt,
      finishedAt ?? lastItemFinishedAt
    )
    if (typeof duration === 'number') durations[userId] = duration
  }

  return durations
}
