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
  /** One-shot deep link from an Agent repair action into its settings detail. */
  settingsHarnessId?: string
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

/** Catalog facts relevant to model discovery; checkedAt is intentionally excluded. */
export function harnessModelFingerprint(row: AdeHarnessRow | undefined): string {
  if (!row) return 'unlisted'
  return JSON.stringify({
    transport: row.definition.transport,
    credentialModes: row.definition.credentialModes,
    modelSource: row.definition.modelSource,
    staticModels: row.definition.staticModels,
    login: row.status.login,
    version: row.status.version,
    command: row.status.resolvedCommand,
    network: row.status.networkFingerprint
  })
}

const modelRequestGeneration = new Map<string, number>()
const generationFor = (id: string): number => modelRequestGeneration.get(id) ?? 0

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
    const previous = useHarnessStore.getState()
    const oldRows = new Map(previous.rows.map((row) => [row.definition.id, harnessModelFingerprint(row)]))
    const newRows = new Map(rows.map((row) => [row.definition.id, harnessModelFingerprint(row)]))
    const models = { ...previous.models }
    const providerGroups = { ...previous.providerGroups }
    for (const id of new Set([...oldRows.keys(), ...newRows.keys()])) {
      if (oldRows.get(id) === newRows.get(id)) continue
      modelRequestGeneration.set(id, generationFor(id) + 1)
      delete models[id]
      delete providerGroups[id]
    }
    useHarnessStore.setState({ rows, rowsLoadedAt: now(), rowsLoading: false, models, providerGroups })
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
  const generation = generationFor(harnessId)
  useHarnessStore.setState((state) => ({
    models: { ...state.models, [harnessId]: { models: existing?.models ?? [], loading: true } }
  }))
  try {
    const result = await provider.listHarnessModels(harnessId)
    if (generation !== generationFor(harnessId)) return
    useHarnessStore.setState((state) => ({
      models: { ...state.models, [harnessId]: { models: result.models, loading: false } }
    }))
  } catch (error) {
    if (generation !== generationFor(harnessId)) return
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
  const generation = generationFor(harnessId)
  useHarnessStore.setState((state) => ({
    providerGroups: {
      ...state.providerGroups,
      [harnessId]: { groups: existing?.groups ?? [], loading: true }
    }
  }))
  try {
    const modes = useHarnessStore.getState().rows.find((row) => row.definition.id === harnessId)?.definition.credentialModes
    const mode = modes?.includes('kun-gateway') ? 'kun-gateway'
      : modes?.includes('provider') || harnessId === 'cursor' || harnessId === 'kun' ? 'provider' : 'kun-gateway'
    const result = await provider.listHarnessModels(harnessId, mode)
    if (generation !== generationFor(harnessId)) return
    useHarnessStore.setState((state) => ({
      providerGroups: {
        ...state.providerGroups,
        [harnessId]: { groups: result.groups ?? [], loading: false }
      }
    }))
  } catch (error) {
    if (generation !== generationFor(harnessId)) return
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

/**
 * Turn-serving rows (P4-13): `transport: 'terminal'` entries are interactive
 * CLIs launched inside a Kun terminal tab — they never host a delegated turn,
 * so every turn picker (composer, one-on-one, subagent profile) hides them.
 */
export function harnessRowRunsTurns(row: AdeHarnessRow): boolean {
  return row.definition.transport !== 'terminal'
}

/** Harness availability for pickers: installed + handshake-ready + signed in. */
export function harnessRowAvailable(row: AdeHarnessRow): boolean {
  const status = row.status
  if (row.definition.transport === 'native-loop') return true
  if (status.installed !== 'yes') return false
  // P4-05: a version below the definition's minVersion cannot serve turns —
  // surface it as unavailable instead of the previous dead "version too low"
  // label branch.
  if (status.versionSupported === false) return false
  // P3-11: a binary that fails the ACP initialize handshake is installed but
  // cannot serve turns — `status.message` carries the sanitized stderr.
  if (status.ready === 'no') return false
  return status.login !== 'signed-out'
}

/**
 * Stable unavailability code for pickers (P4-05). Returns the 'detecting'
 * sentinel while a probe is inflight or the verdict is still provisional;
 * otherwise the wire `reasonCode` (falling back to field derivation for
 * statuses that predate it). Consumers localize `adeHarnessUnavailable.*`
 * and `adeHarnessNextStep.*` from this — never the raw message.
 */
export function harnessRowUnavailableCode(row: AdeHarnessRow): string | null {
  if (row.status.detecting === true) return 'detecting'
  if (harnessRowAvailable(row)) return null
  const status = row.status
  if (status.reasonCode) return status.reasonCode
  if (status.installed === 'no') return 'not_installed'
  if (status.installed === 'yes') {
    if (status.versionSupported === false) return 'version_too_low'
    if (status.ready === 'no') return 'handshake_failed'
    // `ready: 'unknown'` (an inconclusive ACP probe, P4-03) stays selectable:
    // never a blocking code. `handshake_timeout` only arrives over the wire
    // as an advisory for management surfaces.
    if (status.login === 'signed-out') return 'signed_out'
  }
  // A settled `unknown` (the version probe failed and the P4-02 polling
  // budget is spent) is unavailable — not "detecting" forever.
  return 'unavailable'
}

/** Raw diagnostic detail; render only inside a "view reason" disclosure. */
export function harnessRowUnavailableDetail(row: AdeHarnessRow): string | null {
  const message = row.status.message?.trim()
  return message || null
}

/** i18n suffix per unavailable code for `adeHarnessUnavailable.*` labels. */
export const HARNESS_UNAVAILABLE_LABEL_KEY: Record<string, string> = {
  detecting: 'detecting',
  not_installed: 'notInstalled',
  adapter_missing: 'adapterMissing',
  version_too_low: 'versionLow',
  handshake_failed: 'handshakeFailed',
  handshake_timeout: 'handshakeTimeout',
  signed_out: 'signedOut',
  disabled: 'disabled',
  unavailable: 'unavailable'
}

/** i18n suffix per code for `adeHarnessNextStep.*` guidance; absent = none. */
export const HARNESS_UNAVAILABLE_NEXT_STEP_KEY: Record<string, string | undefined> = {
  not_installed: 'install',
  adapter_missing: 'installAdapter',
  version_too_low: 'upgrade',
  handshake_failed: 'retry',
  handshake_timeout: 'retry',
  signed_out: 'login',
  disabled: 'enable',
  unavailable: 'retry'
}

export function harnessUnavailableLabelKey(code: string): string {
  return `adeHarnessUnavailable.${HARNESS_UNAVAILABLE_LABEL_KEY[code] ?? 'unavailable'}`
}

export function harnessUnavailableNextStepKey(code: string): string | null {
  const suffix = HARNESS_UNAVAILABLE_NEXT_STEP_KEY[code]
  return suffix ? `adeHarnessNextStep.${suffix}` : null
}
