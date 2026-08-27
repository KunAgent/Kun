export type GuiUpdateScheduleState = {
  lastAttemptAt?: number | null
  lastSuccessAt?: number | null
  consecutiveFailures?: number
  nextRetryAt?: number | null
}

type LegacyGuiUpdateScheduleState = GuiUpdateScheduleState & { lastCheckedAt?: unknown }

export const GUI_UPDATE_DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const GUI_UPDATE_FAILURE_BACKOFF_MS = [5, 15, 60, 6 * 60].map((minutes) => minutes * 60 * 1000)
export const GUI_UPDATE_RETRY_JITTER_RATIO = 0.2
export const GUI_UPDATE_BUSY_STATE_DELAY_MS = 30 * 60 * 1000
export const GUI_UPDATE_MIN_BACKGROUND_DELAY_MS = 60 * 1000

function validTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeGuiUpdateScheduleState(raw: unknown): GuiUpdateScheduleState {
  if (!raw || typeof raw !== 'object') return {}
  const state = raw as LegacyGuiUpdateScheduleState
  const lastSuccessAt = validTimestamp(state.lastSuccessAt) ?? validTimestamp(state.lastCheckedAt)
  const lastAttemptAt = validTimestamp(state.lastAttemptAt)
  const nextRetryAt = validTimestamp(state.nextRetryAt)
  const consecutiveFailures = Math.max(0, Math.floor(Number(state.consecutiveFailures) || 0))
  return {
    ...(lastAttemptAt ? { lastAttemptAt } : {}),
    ...(lastSuccessAt ? { lastSuccessAt } : {}),
    ...(nextRetryAt ? { nextRetryAt } : {}),
    ...(consecutiveFailures ? { consecutiveFailures } : {})
  }
}

export function failureBackoffMs(consecutiveFailures: number, random = Math.random): number {
  const index = Math.max(0, Math.min(GUI_UPDATE_FAILURE_BACKOFF_MS.length - 1, consecutiveFailures - 1))
  const base = GUI_UPDATE_FAILURE_BACKOFF_MS[index]
  const jitter = 1 + (Math.max(0, Math.min(1, random())) * 2 - 1) * GUI_UPDATE_RETRY_JITTER_RATIO
  return Math.round(base * jitter)
}

export function nextGuiUpdateCheckDelay(
  state: GuiUpdateScheduleState | null | undefined,
  nowMs = Date.now()
): number {
  const normalized = normalizeGuiUpdateScheduleState(state)
  const dueAt = normalized.nextRetryAt ?? (
    normalized.lastSuccessAt ? normalized.lastSuccessAt + GUI_UPDATE_DAILY_CHECK_INTERVAL_MS : null
  )
  if (!dueAt) return 0
  return Math.max(GUI_UPDATE_MIN_BACKGROUND_DELAY_MS, dueAt - nowMs)
}

export function scheduleStateAfterSuccess(
  state: GuiUpdateScheduleState | null | undefined,
  nowMs: number
): GuiUpdateScheduleState {
  return { ...normalizeGuiUpdateScheduleState(state), lastAttemptAt: nowMs, lastSuccessAt: nowMs, consecutiveFailures: 0, nextRetryAt: null }
}

export function scheduleStateAfterFailure(
  state: GuiUpdateScheduleState | null | undefined,
  nowMs: number,
  random = Math.random
): GuiUpdateScheduleState {
  const previous = normalizeGuiUpdateScheduleState(state)
  const consecutiveFailures = (previous.consecutiveFailures ?? 0) + 1
  return {
    ...previous,
    lastAttemptAt: nowMs,
    consecutiveFailures,
    nextRetryAt: nowMs + failureBackoffMs(consecutiveFailures, random)
  }
}
