import { create } from 'zustand'
import type { HarnessUpdateState, HarnessUpdateJob } from '../../../../kun/src/contracts/harness-update'
import { rendererRuntimeClient } from '../agent/runtime-client'
const STORAGE = 'kun.agent-updates.v1'
type Entry = { info?: HarnessUpdateState; loading?: boolean; checkedAt?: number; error?: string; dismissedVersion?: string; remindAfter?: number }
function restored(): Record<string, Entry> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
      if (!/^[a-z0-9-]+$/.test(id) || !raw || typeof raw !== 'object') return []
      const entry = raw as Entry
      if (!entry.info?.current || typeof entry.info.current.fingerprint !== 'string' || entry.info.harnessId !== id) return []
      // Cached notices are never authority to activate an executable.
      return [[id, { ...entry, loading: false, info: { ...entry.info, job: undefined } }]]
    }))
  } catch { return {} }
}
export const useHarnessUpdateStore = create<{ entries: Record<string, Entry> }>(() => ({ entries: restored() }))
const pending = new Map<string, Promise<void>>()
function save(id: string, patch: Partial<Entry>): void {
  useHarnessUpdateStore.setState((state) => ({ entries: { ...state.entries, [id]: { ...state.entries[id], ...patch } } }))
  try {
    const values = Object.fromEntries(Object.entries(useHarnessUpdateStore.getState().entries).map(([key, entry]) =>
      [key, { ...entry, loading: false, info: entry.info ? { ...entry.info, job: undefined } : undefined }]))
    localStorage.setItem(STORAGE, JSON.stringify(values))
  } catch { /* Memory-only fallback. */ }
}
export async function agentUpdateRequest<T>(id: string, action?: string, body?: unknown): Promise<T> {
  const response = await rendererRuntimeClient.runtimeRequest(`/v1/harnesses/${encodeURIComponent(id)}/updates${action ? `/${action}` : ''}`,
    action ? 'POST' : 'GET', action ? JSON.stringify(body ?? {}) : undefined)
  if (!response.ok) { let message = 'Agent update request failed'; try { message = JSON.parse(response.body).message || message } catch { /* fallback */ }; throw new Error(message) }
  return JSON.parse(response.body) as T
}
export function checkHarnessUpdate(id: string, force = false, refreshJob = false): Promise<void> {
  if (id === 'kun' || typeof window === 'undefined' || !window.kunGui?.runtimeRequest) return Promise.resolve()
  const entry = useHarnessUpdateStore.getState().entries[id]
  const ttl = entry?.error || entry?.info?.status === 'unknown' ? 5 * 60_000 : 24 * 60 * 60_000
  if (!force && !refreshJob && entry?.info && Date.now() - (entry.checkedAt ?? 0) < ttl) return Promise.resolve()
  const existing = pending.get(id)
  if (existing) return existing
  save(id, { loading: true })
  const request = agentUpdateRequest<HarnessUpdateState>(id, force ? 'check' : undefined, force ? { force: true } : undefined)
    .then((info) => save(id, { info, loading: false, error: undefined, checkedAt: Date.now() }))
    .catch((error) => save(id, { loading: false, error: String(error) }))
    .finally(() => pending.delete(id))
  pending.set(id, request)
  return request
}
export function receiveHarnessUpdate(info: HarnessUpdateState): void { save(info.harnessId, { info, checkedAt: Date.now(), error: undefined }) }
export function dismissHarnessUpdate(id: string, later = false): void {
  const info = useHarnessUpdateStore.getState().entries[id]?.info
  save(id, later ? { remindAfter: Date.now() + 24 * 60 * 60_000 } : { dismissedVersion: updateVersion(info) })
}
function updateVersion(info?: HarnessUpdateState): string | undefined {
  return info ? [info.latestVersion, info.candidate?.version].filter(Boolean).join('/') || undefined : undefined
}
export function hasHarnessUpdate(id: string): boolean {
  const entry = useHarnessUpdateStore.getState().entries[id]
  if (!entry?.info || (entry.remindAfter ?? 0) > Date.now()) return false
  const version = updateVersion(entry.info)
  return Boolean(version && version !== entry.dismissedVersion && (entry.info.status === 'available' || entry.info.candidate))
}
export const harnessUpdateBusy = (job?: HarnessUpdateJob): boolean => Boolean(job && ['waiting', 'running', 'verifying', 'ready'].includes(job.status))
