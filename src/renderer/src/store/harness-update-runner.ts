import { create } from 'zustand'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { normalizeKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { agentCommandPath, withAgentCommandPath } from '@shared/harness-provider-settings'
import type { HarnessUpdateJob, HarnessUpdateState } from '../../../../kun/src/contracts/harness-update'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { AGENT_UPDATE_RUNNING, type AgentUpdateItem, type AgentUpdatePhase } from './harness-update-item'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { waitForAgentSettings } from '../components/ade/agent-enablement-settings'
import { agentUpdateRequest, checkHarnessUpdate, receiveHarnessUpdate, useHarnessUpdateStore } from './harness-update-store'
import { applyHarnessEnablementSettings, harnessIdsWithChangedLaunchSettings, invalidateHarnessModels, loadHarnesses,
  loadHarnessModels, useHarnessStore } from './harness-store'

export type { AgentUpdateItem, AgentUpdatePhase } from './harness-update-item'
export { AGENT_UPDATE_RUNNING } from './harness-update-item'
const BUSY_JOB = new Set(['waiting', 'running', 'verifying'])
const POLL_MS = 1_500

/**
 * Agent updates run in the background (docs/ade/18 §10): this module, not the
 * Version tab, polls the job and performs the final switch to the verified
 * executable, so leaving the tab, the Agent or Settings never strands a job
 * in maintenance. Every surface (banner, list row, toast) reads `items`.
 */
export const useAgentUpdateRunner = create<{ items: Record<string, AgentUpdateItem> }>(() => ({ items: {} }))

/** Where the switch to a verified executable reads and writes harness settings. */
export type AgentUpdateSettingsPort = {
  read: () => Promise<KunHarnessSettingsV1>
  write: (patch: Partial<KunHarnessSettingsV1>) => Promise<KunHarnessSettingsV1>
}

let flushSettings: (() => Promise<boolean>) | null = null
/** Settings registers its pending-save flush so a direct write never races an unsaved edit. */
export function registerAgentUpdateSettingsFlush(flush: () => Promise<boolean>): () => void {
  flushSettings = flush
  return () => { if (flushSettings === flush) flushSettings = null }
}

async function readHarnessSettings(): Promise<KunHarnessSettingsV1> {
  return normalizeKunHarnessSettings(getKunRuntimeSettings(await rendererRuntimeClient.getSettings({ forceRefresh: true })).harnesses)
}

const directPort: AgentUpdateSettingsPort = {
  read: readHarnessSettings,
  async write(patch) {
    if (flushSettings && !await flushSettings()) throw new Error('agentUpdate.saveFailed')
    const previous = await readHarnessSettings()
    const next = { ...previous, ...patch }
    applyHarnessEnablementSettings(next, harnessIdsWithChangedLaunchSettings(previous, next))
    const saved = await rendererRuntimeClient.setSettings({ agents: { kun: { harnesses: next } } })
    // Settings (when open) replaces its form with what was saved.
    emitRendererSettingsChanged(saved)
    return next
  }
}
let port: AgentUpdateSettingsPort = directPort
/** Test seam; `undefined` restores the direct settings port. */
export function setAgentUpdateSettingsPort(next?: AgentUpdateSettingsPort): void { port = next ?? directPort }

const polls = new Map<string, ReturnType<typeof setTimeout>>()
const activating = new Set<string>()
const cancelRequested = new Set<string>()
/** Finished jobs the user already closed; a later status refresh must not bring them back. */
const dismissedJobs = new Set<string>()

const item = (id: string): AgentUpdateItem | undefined => useAgentUpdateRunner.getState().items[id]
function put(id: string, patch: Partial<AgentUpdateItem> | null): void {
  useAgentUpdateRunner.setState((state) => {
    const items = { ...state.items }
    if (patch === null) delete items[id]
    else items[id] = { ...items[id], ...patch } as AgentUpdateItem
    return { items }
  })
}
function stopPolling(id: string): void {
  const timer = polls.get(id)
  if (timer) clearTimeout(timer)
  polls.delete(id)
}
function finish(id: string, patch: Partial<AgentUpdateItem>): void {
  stopPolling(id)
  put(id, { ...patch, finishedAt: Date.now() })
}

function phaseFor(status: HarnessUpdateJob['status']): AgentUpdatePhase | null {
  switch (status) {
    case 'waiting': case 'running': case 'verifying': return status
    case 'ready': return 'switching'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    default: return null
  }
}

function schedulePoll(id: string): void {
  if (polls.has(id)) return
  polls.set(id, setTimeout(() => {
    polls.delete(id)
    void agentUpdateRequest<HarnessUpdateState>(id).then((state) => {
      receiveHarnessUpdate(state)
      syncJob(id, state.job, true)
    }).catch(() => { if (item(id) && AGENT_UPDATE_RUNNING.has(item(id)!.phase)) schedulePoll(id) })
  }, POLL_MS))
}

/** Folds a job the runtime reported into this Agent's item and drives the next step. */
function syncJob(id: string, job: HarnessUpdateJob | undefined, fromRunner = false): void {
  const current = item(id)
  if (current?.phase === 'starting' && !fromRunner) return
  if (!job) {
    // The runtime forgot the job (restart): nothing is running any more.
    if (current && AGENT_UPDATE_RUNNING.has(current.phase) && current.phase !== 'switching' && fromRunner) put(id, null)
    return
  }
  if (dismissedJobs.has(job.id)) return
  if (current?.jobId === job.id && (current.phase === 'completed' || current.phase === 'failed' || current.phase === 'switching')) return
  const phase = phaseFor(job.status)
  if (!phase) {
    if (current?.jobId === job.id || job.status === 'cancelled' && current?.phase === 'starting') put(id, null)
    return
  }
  // A finished job is only news to the session that started it.
  if (!current && phase === 'completed') return
  const startedAt = Date.parse(job.startedAt)
  put(id, {
    harnessId: id, action: job.action, phase, jobId: job.id,
    startedAt: Number.isFinite(startedAt) ? startedAt : current?.startedAt ?? Date.now(),
    version: job.version ?? current?.version, output: job.output,
    ...(job.error ? { error: job.error } : {})
  })
  if (cancelRequested.has(id)) { void cancelAgentUpdate(id); return }
  if (BUSY_JOB.has(job.status)) schedulePoll(id)
  else if (job.status === 'ready') void activate(id, job)
  else finish(id, phase === 'completed'
    ? { phase, canRollback: Boolean(job.previousPath && job.previousPath !== job.activationPath) }
    : { phase, error: job.error ?? current?.error, failedAt: current && AGENT_UPDATE_RUNNING.has(current.phase) ? current.phase : 'running' })
}

/** Switches Kun to the verified executable, or restores the previous one if that fails. */
async function activate(id: string, job: HarnessUpdateJob): Promise<void> {
  if (!job.activationPath || activating.has(job.id)) return
  activating.add(job.id)
  stopPolling(id)
  put(id, { phase: 'switching' })
  let saved = false
  let restorePath = job.previousPath ?? ''
  try {
    const resolved = useHarnessStore.getState().rows.find((row) => row.definition.id === id)?.status.resolvedCommand
    if (resolved && job.previousPath && resolved !== job.previousPath && resolved !== job.activationPath) throw new Error('agentUpdate.settingsChanged')
    const confirmed = await agentUpdateRequest<HarnessUpdateState>(id)
    const live = confirmed.job
    if (live?.id !== job.id || live.status !== 'ready' || live.activationFingerprint !== job.activationFingerprint ||
      live.activationPath !== job.activationPath) {
      // A stale notice is never authority to switch executables.
      put(id, null)
      receiveHarnessUpdate(confirmed)
      return
    }
    const settings = await port.read()
    const selected = agentCommandPath(settings.providers, id)
    restorePath = (selected === job.activationPath ? job.previousPath : selected) || job.previousPath || ''
    const next = await port.write({ providers: withAgentCommandPath(settings.providers, id, job.activationPath) })
    saved = true
    await waitForAgentSettings(next, AbortSignal.timeout(30_000), { harnessId: id })
    await agentUpdateRequest(id, 'activate', { jobId: job.id })
    invalidateHarnessModels(id)
    await loadHarnesses(true)
    await loadHarnessModels(id, true)
    await checkHarnessUpdate(id, true)
    finish(id, { phase: 'completed', version: job.version ?? item(id)?.version, error: undefined,
      canRollback: Boolean(job.previousPath && job.previousPath !== job.activationPath) })
  } catch (cause) {
    let error = cause instanceof Error ? cause.message : String(cause)
    if (saved) {
      try {
        // Restore only this path; other settings edited meanwhile stay.
        const settings = await port.read()
        const restored = await port.write({ providers: withAgentCommandPath(settings.providers, id, restorePath) })
        await waitForAgentSettings(restored, AbortSignal.timeout(30_000), { harnessId: id })
        await agentUpdateRequest(id, 'cancel', { jobId: job.id })
        await checkHarnessUpdate(id, true)
        await loadHarnesses(true)
      } catch (restoreError) {
        error = `${error} · ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
      }
    }
    finish(id, { phase: 'failed', error, failedAt: 'switching' })
  } finally {
    activating.delete(job.id)
  }
}

/**
 * Starts an update, local switch or managed install. The item exists before
 * any await, so the page shows progress the moment the user clicks.
 */
export async function startAgentUpdate(id: string, action: 'update' | 'managed' | 'use-local'): Promise<void> {
  const existing = item(id)
  if (existing && AGENT_UPDATE_RUNNING.has(existing.phase)) return
  const state = useHarnessUpdateStore.getState().entries[id]?.info
  if (existing?.jobId) dismissedJobs.add(existing.jobId)
  cancelRequested.delete(id)
  put(id, null)
  put(id, { harnessId: id, action, phase: 'starting', startedAt: Date.now(), previousVersion: state?.current.version,
    version: action === 'use-local' ? state?.candidate?.version : state?.latestVersion })
  try {
    if (flushSettings && !await flushSettings()) throw new Error('agentUpdate.saveFailed')
    // Saving settings can finish a re-check; bind the click to the installation shown now.
    const shown = useHarnessUpdateStore.getState().entries[id]?.info?.current.fingerprint ?? state?.current.fingerprint
    if (!shown) throw new Error('agentUpdate.installationChanged')
    const started = await agentUpdateRequest<HarnessUpdateState>(id, 'start', { action, expectedFingerprint: shown })
    receiveHarnessUpdate(started)
    syncJob(id, started.job, true)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/installation changed/i.test(message)) {
      // Show what is installed now instead of a bare mismatch.
      await checkHarnessUpdate(id, true).catch(() => undefined)
      finish(id, { phase: 'failed', error: 'agentUpdate.installationChanged', failedAt: 'starting' })
    } else finish(id, { phase: 'failed', error: message, failedAt: 'starting' })
  }
}

/** Restores the executable a completed update replaced. */
export async function rollbackAgentUpdate(id: string, jobId: string): Promise<void> {
  if (item(id) && AGENT_UPDATE_RUNNING.has(item(id)!.phase)) return
  const previous = item(id)
  dismissedJobs.add(jobId)
  put(id, null)
  put(id, { harnessId: id, action: 'rollback', phase: 'starting', startedAt: Date.now(),
    previousVersion: previous?.version, version: previous?.previousVersion })
  try {
    const state = await agentUpdateRequest<HarnessUpdateState>(id, 'rollback', { jobId })
    receiveHarnessUpdate(state)
    syncJob(id, state.job, true)
  } catch (cause) {
    finish(id, { phase: 'failed', error: cause instanceof Error ? cause.message : String(cause), failedAt: 'starting' })
  }
}

export async function cancelAgentUpdate(id: string): Promise<void> {
  const current = item(id)
  if (!current) return
  if (!current.jobId) { cancelRequested.add(id); return }
  cancelRequested.delete(id)
  if (current.phase === 'switching') return
  stopPolling(id)
  dismissedJobs.add(current.jobId)
  put(id, null)
  try {
    await agentUpdateRequest(id, 'cancel', { jobId: current.jobId })
  } finally {
    await checkHarnessUpdate(id, true).catch(() => undefined)
  }
}

/** Closes a finished result everywhere (banner and card). */
export function dismissAgentUpdate(id: string): void {
  const current = item(id)
  if (!current || AGENT_UPDATE_RUNNING.has(current.phase)) return
  if (current.jobId) dismissedJobs.add(current.jobId)
  put(id, null)
}

/** Hides the floating card only; the page keeps its banner. */
export function hideAgentUpdateToast(id: string): void {
  if (item(id)) put(id, { toastHidden: true })
}

// A job reported by any status read (another window, a reload, the Version
// tab opening) is adopted, so its switch-over still happens.
useHarnessUpdateStore.subscribe((state, previous) => {
  if (state.entries === previous.entries) return
  for (const [id, entry] of Object.entries(state.entries)) {
    const job = entry.info?.job
    if (!job || job.id === previous.entries[id]?.info?.job?.id && job.status === previous.entries[id]?.info?.job?.status) continue
    syncJob(id, job)
  }
})

/** Test-only reset of module state. */
export function resetAgentUpdateRunner(): void {
  for (const id of [...polls.keys()]) stopPolling(id)
  activating.clear(); cancelRequested.clear(); dismissedJobs.clear()
  useAgentUpdateRunner.setState({ items: {} })
}
