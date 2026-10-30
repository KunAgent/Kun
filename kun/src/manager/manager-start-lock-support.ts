import { setTimeout as delay } from 'node:timers/promises'

export type ManagerStartLockReason = 'busy' | 'unverifiable' | 'corrupt' | 'io'
export class ManagerStartLockError extends Error {
  readonly code = 'manager_start_lock'
  constructor(
    readonly lockPath: string,
    readonly reason: ManagerStartLockReason,
    readonly waitedMs: number,
    readonly ownerPid?: number,
    readonly filesystemCode?: string
  ) {
    const detail = reason === 'busy' ? 'Another Kun startup has not released its lock'
      : reason === 'unverifiable' ? 'The previous Kun startup owner could not be verified'
        : reason === 'corrupt' ? 'The previous Kun startup lock is incomplete or damaged'
          : 'Kun could not access its startup lock'
    super(`${detail}${ownerPid ? ` (pid ${ownerPid})` : ''}. Lock: ${lockPath}. Waited ${Math.round(waitedMs)}ms${filesystemCode ? `; ${filesystemCode}` : ''}.`)
    this.name = 'ManagerStartLockError'
  }
}

export const MANAGER_START_LOCK_TIMEOUT_MS = 40_000
export function lockErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '')
}
export async function waitForStartLock(deadline: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await delay(Math.max(1, Math.min(100, deadline - performance.now())), undefined, { signal })
}

/** Never release a live critical section through a timeout race. */
export async function runWithStartLock<T>(action: () => Promise<T>, release: () => Promise<void> | void): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try { outcome = { ok: true, value: await action() } }
  catch (error) { outcome = { ok: false, error } }
  try { await release() } catch (error) {
    if (!outcome.ok) {
      throw new AggregateError([outcome.error, error], 'Kun startup failed and its lock cleanup also failed', { cause: outcome.error })
    }
    throw error
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
