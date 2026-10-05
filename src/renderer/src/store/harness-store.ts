import { create } from 'zustand'
import type {
  AdeHarnessCommand,
  AdeHarnessModels,
  AdeHarnessProviderModelGroup,
  AdeHarnessRow,
  AdeHarnessSessionState
} from '@shared/ade-harnesses'
import { harnessProfileKey, readyHarnessProfiles } from '@shared/harness-enablement'
import { getProvider } from '../agent/registry'

/**
 * Harness catalog + per-thread session surface (docs/ade/12 §7.2).
 *
 * - `rows` is the `GET /v1/harnesses` cache; ordinary menu opens reuse it.
 *   Settings changes and explicit refreshes invalidate it (`probe` stays server-side).
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
  models: Record<string, { models: string[]; modelInfo?: AdeHarnessModels['modelInfo']; detailsModel?: string; loadedAt?: number; loading: boolean; error?: string }>
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
export const HARNESS_CATALOG_TTL_MS = 30_000

let expiryTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollWindowStart: number | null = null
let retryCount = 0
let pollGeneration = 0
let catalogGeneration = 0
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
  const fresh = state.rowsLoadedAt !== undefined && now() - state.rowsLoadedAt < HARNESS_CATALOG_TTL_MS
  if (state.rowsLoading || (fresh && !force)) return
  const requestGeneration = ++catalogGeneration
  useHarnessStore.setState({ rowsLoading: true, rowsError: undefined })
  try {
    const rows = await provider.listHarnesses({ ...options, includeDisabled: true })
    if (requestGeneration !== catalogGeneration) return
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
    scheduleReadinessExpiry(rows)
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
    if (requestGeneration !== catalogGeneration) return
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

export async function loadHarnessModels(harnessId: string, force = false, selectedModel?: string): Promise<void> {
  const provider = getProvider()
  if (!provider.listHarnessModels) return
  const existing = useHarnessStore.getState().models[harnessId]
  if (existing?.loading || (existing && !existing.error && !force &&
    (!selectedModel || existing.detailsModel === selectedModel) && Date.now() - (existing.loadedAt ?? 0) < 60_000)) return
  const generation = generationFor(harnessId)
  useHarnessStore.setState((state) => ({
    models: { ...state.models, [harnessId]: { ...existing, models: existing?.models ?? [], loading: true } }
  }))
  try {
    const result = selectedModel ? await provider.listHarnessModels(harnessId, undefined, selectedModel) : await provider.listHarnessModels(harnessId)
    if (selectedModel && !result.models.length) throw new Error('Native model details are temporarily unavailable')
    if (generation !== generationFor(harnessId)) return
    useHarnessStore.setState((state) => ({
      models: { ...state.models, [harnessId]: { models: result.models, modelInfo: result.modelInfo?.map((entry) => {
        const previous = existing?.modelInfo?.find((old) => old.id === entry.id)
        return { ...(entry.reasoningEfforts === undefined && previous?.reasoningEfforts !== undefined
          ? { reasoningEfforts: previous.reasoningEfforts, defaultReasoningEffort: previous.defaultReasoningEffort } : {}), ...entry }
      }), detailsModel: selectedModel,
        loadedAt: Date.now(), loading: false } }
    }))
  } catch (error) {
    if (generation !== generationFor(harnessId)) return
    useHarnessStore.setState((state) => ({
      models: {
        ...state.models,
        [harnessId]: {
          models: existing?.models ?? [],
          modelInfo: existing?.modelInfo,
          detailsModel: selectedModel,
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
  if (row.definition.transport === 'native-loop') return row.definition.id === 'kun'
  return harnessRowRunsTurns(row) && readyHarnessProfiles(row).length > 0
}

/**
 * Stable unavailability code for pickers (P4-05). Returns the 'detecting'
 * sentinel while a probe is inflight or the verdict is still provisional;
 * otherwise the wire `reasonCode` (falling back to field derivation for
 * statuses that predate it). Consumers localize `adeHarnessUnavailable.*`
 * and `adeHarnessNextStep.*` from this — never the raw message.
 */
export function harnessRowUnavailableCode(row: AdeHarnessRow): string | null {
  if (harnessRowAvailable(row)) return null
  if (row.status.detecting === true) return 'detecting'
  const status = row.status
  if (row.definition.id === 'gemini-cli' || row.definition.availability === 'retired') return 'disabled'
  if (status.reasonCode && status.reasonCode !== 'disabled') return status.reasonCode
  if (row.enabled !== true) return 'disabled'
  if (status.installed === 'no') return 'not_installed'
  if (status.installed === 'yes') {
    if (status.versionSupported === false) return 'version_too_low'
    if (status.ready === 'no') return 'handshake_failed'
    if (status.login === 'signed-out') return 'signed_out'
  }
  // A settled `unknown` (the version probe failed and the P4-02 polling
  // budget is spent) is unavailable — not "detecting" forever.
  return 'readiness_required'
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
  readiness_required: 'readinessRequired',
  configuration_invalid: 'configurationInvalid',
  credentials_missing: 'credentialsMissing',
  authentication_unverified: 'authenticationUnverified',
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
  readiness_required: 'enable',
  configuration_invalid: 'configure',
  credentials_missing: 'login',
  authentication_unverified: 'login',
  unavailable: 'retry'
}

export function harnessUnavailableLabelKey(code: string): string {
  return `adeHarnessUnavailable.${HARNESS_UNAVAILABLE_LABEL_KEY[code] ?? 'unavailable'}`
}

export function harnessUnavailableNextStepKey(code: string): string | null {
  const suffix = HARNESS_UNAVAILABLE_NEXT_STEP_KEY[code]
  return suffix ? `adeHarnessNextStep.${suffix}` : null
}

/** Drop removed grants immediately; an in-flight older catalog cannot restore them. */
export function applyHarnessEnablementSettings(settings: import('@shared/app-settings').KunHarnessSettingsV1,
  invalidateReadiness = false): void {
  catalogGeneration += 1
  useHarnessStore.setState((state) => ({ rowsLoading: false, rowsLoadedAt: undefined, rows: state.rows.map((row) => {
    if (row.definition.id === 'kun') return row
    const enabledProfiles = settings.disabledIds.includes(row.definition.id) ? [] :
      (settings.enabledProfiles ?? []).filter((entry) => entry.harnessId === row.definition.id)
    return { ...row, enabled: enabledProfiles.length > 0, enabledProfiles,
      readyProfiles: invalidateReadiness ? [] : (row.readyProfiles ?? []).filter((entry) =>
        enabledProfiles.some((enabled) => harnessProfileKey(entry) === harnessProfileKey(enabled))) }
  }) }))
}

/** Expiring proofs disappear even while a composer menu is left open. */
function scheduleReadinessExpiry(rows: AdeHarnessRow[]): void {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  const expirations = rows.flatMap((row) => (row.readyProfiles ?? []).map((profile) => Date.parse(profile.expiresAt ?? '')))
    .filter((expiration) => Number.isFinite(expiration) && expiration > Date.now())
  if (!expirations.length) return
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    useHarnessStore.setState((state) => ({ rows: state.rows.map((row) => ({ ...row,
      readyProfiles: (row.readyProfiles ?? []).filter((profile) => Date.parse(profile.expiresAt ?? '') > Date.now()) })) }))
    scheduleReadinessExpiry(useHarnessStore.getState().rows)
    // Expired proofs must be revalidated even when the catalog's short UI cache is fresh.
    void loadHarnesses(true)
  }, Math.max(1, Math.min(...expirations) - Date.now() + 1))
  // Catalog caches must not keep a non-browser test process alive.
  if (typeof expiryTimer === 'object' && 'unref' in expiryTimer) expiryTimer.unref()
}
