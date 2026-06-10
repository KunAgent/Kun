import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  getRuntimeBaseUrlForSettings,
  runtimeAuthHeaders
} from './kun-adapter'

export type RuntimeThreadsListResult = {
  ok: boolean
  status: number
  body: string
}

export type WaitForRuntimeIdleOptions = {
  settings: AppSettingsV1
  fetchThreads?: (settings: AppSettingsV1) => Promise<RuntimeThreadsListResult>
  sleepMs?: (ms: number) => Promise<void>
  timeoutMs?: number
  intervalMs?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_IDLE_POLL_MS = 1_000

export function runtimeThreadsListHasActiveTurn(body: string): boolean {
  const parsed = parseJsonObject(body)
  const threads = Array.isArray(parsed?.threads) ? parsed.threads : []
  return threads.some((thread) => {
    const record = asRecord(thread)
    if (!record) return false
    if (isActiveStatus(asString(record.status))) return true
    const turns = Array.isArray(record.turns) ? record.turns : []
    return turns.some((turn) => isActiveStatus(asString(asRecord(turn)?.status)))
  })
}

export async function waitForRuntimeTurnsIdle(
  options: WaitForRuntimeIdleOptions
): Promise<'idle' | 'timeout' | 'unavailable'> {
  const fetchThreads = options.fetchThreads ?? fetchRuntimeThreads
  const sleepMs = options.sleepMs ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? DEFAULT_IDLE_POLL_MS
  const deadline = Date.now() + Math.max(0, timeoutMs)

  while (true) {
    let result: RuntimeThreadsListResult
    try {
      result = await fetchThreads(options.settings)
    } catch {
      return 'unavailable'
    }
    if (!result.ok) return 'unavailable'
    if (!runtimeThreadsListHasActiveTurn(result.body)) return 'idle'
    if (Date.now() >= deadline) return 'timeout'
    await sleepMs(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }
}

async function fetchRuntimeThreads(settings: AppSettingsV1): Promise<RuntimeThreadsListResult> {
  const url = `${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=500&include=side`
  const res = await fetch(url, {
    headers: runtimeAuthHeaders(settings),
    signal: AbortSignal.timeout(5_000)
  })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isActiveStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}
