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

const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'aborted'])

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
