import { z } from 'zod'
import { inspectRuntimeProcess, runtimeProcessInspectionMatchesRecord } from '../server/runtime-process-identity.js'

export type StartLockOwnerState = 'missing' | 'empty' | 'malformed' | 'invalid' | 'dead' | 'reused' | 'alive' | 'unknown'
export type StartLockScope = 'manager' | 'dataDir' | 'controlDir' | 'settingsPath'
export type StartLockDiagnostic = {
  scope: StartLockScope
  path: string
  phase: 'acquire' | 'inspect' | 'write' | 'release'
  waitedMs: number
  attemptId: string
  ownerPid?: number
  ownerState?: StartLockOwnerState
  errno?: string
}

export class ManagerStartLockError extends Error {
  readonly code = 'manager_start_lock_failed'
  constructor(readonly reason: 'timeout' | 'unverifiable' | 'io', readonly diagnostic: StartLockDiagnostic) {
    super(`Kun startup coordination ${reason}: ${diagnostic.scope} (${diagnostic.ownerState ?? diagnostic.errno ?? diagnostic.phase})`)
    this.name = 'ManagerStartLockError'
  }
}

const OwnerSchema = z.object({
  pid: z.number().int().positive(),
  acquiredAt: z.string().datetime().optional(),
  processIdentity: z.string().min(1).max(512).optional(),
  instanceId: z.string().min(1).optional(),
  generation: z.number().int().positive().optional()
})

export function classifyStartLock(text: string): { state: StartLockOwnerState; pid?: number } {
  if (!text.trim()) return { state: 'empty' }
  let value: unknown
  try { value = JSON.parse(text) } catch { return { state: 'malformed' } }
  const parsed = OwnerSchema.safeParse(value)
  if (!parsed.success) return { state: 'invalid' }
  const owner = parsed.data
  try { process.kill(owner.pid, 0) } catch (error) {
    return { state: lockErrno(error) === 'ESRCH' ? 'dead' : 'unknown', pid: owner.pid }
  }
  const inspection = inspectRuntimeProcess(owner.pid)
  if (!inspection) return { state: 'unknown', pid: owner.pid }
  if (!owner.processIdentity && !owner.acquiredAt) return { state: 'unknown', pid: owner.pid }
  if (!owner.processIdentity && inspection.startedAtMs === undefined) return { state: 'unknown', pid: owner.pid }
  const matches = runtimeProcessInspectionMatchesRecord({
    startedAt: owner.acquiredAt ?? '', processIdentity: owner.processIdentity
  }, inspection)
  return { state: matches ? 'alive' : 'reused', pid: owner.pid }
}

export function lockErrno(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : undefined
}
