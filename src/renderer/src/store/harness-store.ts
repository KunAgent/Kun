import { create } from 'zustand'
import type {
  AdeHarnessCommand,
  AdeHarnessProviderModelGroup,
  AdeHarnessRow,
  AdeHarnessSessionState
} from '@shared/ade-harnesses'
import { getProvider } from '../agent/registry'

/**
 * Harness catalog + per-thread session surface (docs/ade/12 §7.2).
 *
 * - `rows` is the `GET /v1/harnesses` cache; settings edits or the picker's
 *   open handler force a reload (`probe` stays server-side).
 * - `models[harnessId]` is the lazy `GET /v1/harnesses/:id/models` cache.
 * - `sessions[threadId]` is the last `harness_session_state` event (03 §7.3):
 *   native slash commands + config options the composer renders.
 */
export type HarnessSessionSurface = {
  harnessId: string
  commands?: AdeHarnessCommand[]
  currentModeId?: string
  updatedAt: string
}

type HarnessStoreState = {
  rows: AdeHarnessRow[]
  /**
   * Timestamp of the last successful list response (P4-02): replaced the
   * load-once `rowsLoaded` flag so callers can force a refresh while
   * detection is still settling.
   */
  rowsLoadedAt?: number
  rowsLoading: boolean
  rowsError?: string
  models: Record<string, { models: string[]; loading: boolean; error?: string }>
  /**
   * Provider-grouped models for `provider`/`kun-gateway` credential modes
   * (12 §7.2): the exposable providers each harness turn could address. The
   * two modes share one exposable set, so a single per-harness entry serves
   * both.
   */
  providerGroups: Record<
    string,
    { groups: AdeHarnessProviderModelGroup[]; loading: boolean; error?: string }
  >
  sessions: Record<string, HarnessSessionSurface>
}

export const useHarnessStore = create<HarnessStoreState>(() => ({
  rows: [],
  rowsLoading: false,
  models: {},
  providerGroups: {},
  sessions: {}
}))

/**
 * P4-02: while any row still reports `detecting`, the store polls the
 * catalog until detection settles or the budget expires — the first load
 * usually lands mid-probe, and without this the sidebar/picker would pin
 * the provisional `unknown` verdict forever.
 */
const DETECTING_POLL_MS = 2_000
const DETECTING_POLL_BUDGET_MS = 30_000
const LOAD_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]

let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollWindowStart: number | null = null
let retryCount = 0
let pollGeneration = 0
let now = (): number => Date.now()

/** Test seam: vitest fake timers need a clock they can advance. */
export function setHarnessStoreNow(next: () => number): void {
  now = next
}

function anyRowDetecting(rows: AdeHarnessRow[]): boolean {
  return rows.some(
    (row) => row.status.detecting === true || row.status.installed === 'unknown'
  )
}

function scheduleHarnessPoll(delayMs: number): void {
  if (pollTimer) clearTimeout(pollTimer)
  const generation = pollGeneration
  pollTimer = setTimeout(() => {
    pollTimer = null
    if (pollGeneration !== generation) return
    void loadHarnesses(true)
  }, delayMs)
}

/** Exported so tests can reset the module-level poll/retry state. */
export function resetHarnessPolling(): void {
  pollGeneration += 1
  pollWindowStart = null
  retryCount = 0
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

export async function loadHarnesses(
  force = false,
  options?: { waitMs?: number }
): Promise<void> {
  const provider = getProvider()
  if (!provider.listHarnesses) return
  const state = useHarnessStore.getState()
  if (state.rowsLoading || (state.rowsLoadedAt !== undefined && !force)) return
  useHarnessStore.setState({ rowsLoading: true, rowsError: undefined })
  try {
    const rows = await provider.listHarnesses(options)
    useHarnessStore.setState({ rows, rowsLoadedAt: now(), rowsLoading: false })
    retryCount = 0
    if (anyRowDetecting(rows)) {
      if (pollWindowStart === null) pollWindowStart = now()
      if (now() - pollWindowStart <= DETECTING_POLL_BUDGET_MS) {
        scheduleHarnessPoll(DETECTING_POLL_MS)
      } else {
        resetHarnessPolling()
      }
    } else {
      resetHarnessPolling()
    }
  } catch (error) {
    useHarnessStore.setState({
      rowsLoading: false,
      rowsError: error instanceof Error ? error.message : String(error)
    })
    // Backoff retry — a transient runtime hiccup used to stick forever.
    if (pollWindowStart === null) pollWindowStart = now()
    const elapsed = now() - pollWindowStart
    if (elapsed <= DETECTING_POLL_BUDGET_MS) {
      const delay = LOAD_RETRY_DELAYS_MS[Math.min(retryCount, LOAD_RETRY_DELAYS_MS.length - 1)]
      retryCount += 1
      scheduleHarnessPoll(delay)
    } else {
      resetHarnessPolling()
    }
  }
}

export async function loadHarnessModels(harnessId: string, force = false): Promise<void> {
  const provider = getProvider()
  if (!provider.listHarnessModels) return
  const existing = useHarnessStore.getState().models[harnessId]
  if (existing?.loading || (existing && !existing.error && !force)) return
  useHarnessStore.setState((state) => ({
    models: { ...state.models, [harnessId]: { models: existing?.models ?? [], loading: true } }
  }))
  try {
    const result = await provider.listHarnessModels(harnessId)
    useHarnessStore.setState((state) => ({
      models: { ...state.models, [harnessId]: { models: result.models, loading: false } }
    }))
  } catch (error) {
    useHarnessStore.setState((state) => ({
      models: {
        ...state.models,
        [harnessId]: {
          models: existing?.models ?? [],
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }))
  }
}

/** Lazy load of the provider-grouped model catalog for provider/gateway modes. */
export async function loadHarnessProviderGroups(
  harnessId: string,
  force = false
): Promise<void> {
  const provider = getProvider()
  if (!provider.listHarnessModels) return
  const existing = useHarnessStore.getState().providerGroups[harnessId]
  if (existing?.loading || (existing && !existing.error && !force)) return
  useHarnessStore.setState((state) => ({
    providerGroups: {
      ...state.providerGroups,
      [harnessId]: { groups: existing?.groups ?? [], loading: true }
    }
  }))
  try {
    const result = await provider.listHarnessModels(harnessId, 'kun-gateway')
    useHarnessStore.setState((state) => ({
      providerGroups: {
        ...state.providerGroups,
        [harnessId]: { groups: result.groups ?? [], loading: false }
      }
    }))
  } catch (error) {
    useHarnessStore.setState((state) => ({
      providerGroups: {
        ...state.providerGroups,
        [harnessId]: {
          groups: existing?.groups ?? [],
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }))
  }
}

/** Sink entry for mapped `harness_session_state` runtime events (03 §7.3). */
export function receiveHarnessSessionState(state: AdeHarnessSessionState): void {
  const threadId = state.threadId.trim()
  if (!threadId || !state.harnessId.trim()) return
  useHarnessStore.setState((current) => ({
    sessions: {
      ...current.sessions,
      [threadId]: {
        harnessId: state.harnessId,
        ...(state.commands !== undefined
          ? { commands: state.commands }
          : current.sessions[threadId]?.commands !== undefined
            ? { commands: current.sessions[threadId]!.commands }
            : {}),
        ...(state.currentModeId !== undefined
          ? { currentModeId: state.currentModeId }
          : current.sessions[threadId]?.currentModeId !== undefined
            ? { currentModeId: current.sessions[threadId]!.currentModeId }
            : {}),
        updatedAt: new Date().toISOString()
      }
    }
  }))
}

/** Harness availability for pickers: installed + handshake-ready + signed in. */
export function harnessRowAvailable(row: AdeHarnessRow): boolean {
  const status = row.status
  if (row.definition.transport === 'native-loop') return true
  if (status.installed !== 'yes') return false
  // P3-11: a binary that fails the ACP initialize handshake is installed but
  // cannot serve turns — `status.message` carries the sanitized stderr.
  if (status.ready === 'no') return false
  return status.login !== 'signed-out'
}

/** User-facing unavailability reason (12 §7.2: 未安装 / 未登录 / 版本过低). */
export function harnessRowUnavailableReason(row: AdeHarnessRow): string | null {
  // P4-02: a detection inflight is not a verdict — callers render a
  // spinner and the localized "detecting" label for this sentinel.
  if (row.status.detecting === true) return 'detecting'
  if (harnessRowAvailable(row)) return null
  if (row.status.message?.trim()) return row.status.message.trim()
  if (row.status.installed === 'no') return 'not installed'
  if (row.status.installed === 'unknown') return 'detecting'
  if (row.status.login === 'signed-out') return 'signed out'
  if (row.status.versionSupported === false) return 'version too low'
  return 'unavailable'
}
