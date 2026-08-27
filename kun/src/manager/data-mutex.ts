import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RuntimeFlavorSchema, type RuntimeFlavor } from '../contracts/runtime-flavor.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import {
  currentManagerDataCommitId,
  currentManagerDataMutexContext,
  runWithManagerDataCommitId,
  runWithManagerDataMutexContext,
  type ManagerDataMutexOperationContext
} from './data-mutex-context.js'

export type { ManagerDataMutexOperationContext } from './data-mutex-context.js'

const LeaseSchema = z.object({
  resource: z.string(),
  ownerFlavor: RuntimeFlavorSchema,
  ownerInstanceId: z.string(),
  fencingToken: z.number().int().positive(),
  expiresAt: z.string(),
  commitExpiresAt: z.string().optional()
}).passthrough()
const AcquireResultSchema = z.object({ acquired: z.boolean(), lease: LeaseSchema }).passthrough()
const RenewResultSchema = z.object({ lease: LeaseSchema })
const OPERATION_ABORT_GRACE_MS = 5_000
const localQueues = new Map<string, Promise<void>>()

/** Serialize a shared-data mutation across Runtime processes. */
export async function withManagerDataMutex<T>(
  resource: string,
  operation: (context: ManagerDataMutexOperationContext) => Promise<T>
): Promise<T> {
  const inherited = currentManagerDataMutexContext()
  if (inherited?.resource === resource) return operation(inherited)
  return enqueueLocal(resource, () => withManagerDataMutexLocked(resource, operation))
}

async function withManagerDataMutexLocked<T>(
  resource: string,
  operation: (context: ManagerDataMutexOperationContext) => Promise<T>
): Promise<T> {
  const manager = managerRuntimeIdentity()
  if (!manager) {
    const context = localContext(resource)
    return runWithManagerDataMutexContext(context, () => operation(context))
  }
  const resourceId = `data:${createHash('sha256').update(resource).digest('hex').slice(0, 32)}`
  const leasePath = `${manager.baseUrl}/v1/leases/resources/${encodeURIComponent(resourceId)}`
  const owner = { ownerFlavor: manager.flavor, ownerInstanceId: manager.instanceId }
  const acquireDeadline = Date.now() + 30_000
  let acquired: z.infer<typeof LeaseSchema>
  for (;;) {
    const result = AcquireResultSchema.parse(await managerRequest(
      `${leasePath}/acquire`, manager.token, owner
    ))
    if (result.acquired) {
      acquired = result.lease
      break
    }
    if (Date.now() >= acquireDeadline) throw new Error(`shared data resource is busy: ${resource}`)
    await delay(100)
  }

  const fence: ManagerResourceFence = {
    resource: resourceId,
    ownerFlavor: acquired.ownerFlavor,
    ownerInstanceId: acquired.ownerInstanceId,
    fencingToken: acquired.fencingToken
  }
  const controller = new AbortController()
  let leaseLostError: Error | undefined
  let rejectLeaseLost: (error: Error) => void = () => undefined
  const leaseLost = new Promise<never>((_, reject) => { rejectLeaseLost = reject })
  leaseLost.catch(() => undefined)
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let leaseExpiresAtMs: number | undefined
  let commitExpiresAtMs: number | undefined
  let stopped = false
  let renewalInFlight = false
  const maintenance = new Set<Promise<void>>()

  const fail = (error: Error) => {
    if (stopped || leaseLostError) return
    leaseLostError = error
    controller.abort(error)
    rejectLeaseLost(error)
  }
  // Preserve the earliest known deadline: ambiguous renewals must never extend it.
  const rescheduleDeadlineTimer = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer)
    if (stopped || leaseLostError) return
    const deadline = [
      { expiresAtMs: leaseExpiresAtMs, kind: 'lease' },
      { expiresAtMs: commitExpiresAtMs, kind: 'commit reservation' }
    ].filter((entry): entry is { expiresAtMs: number, kind: string } =>
      Number.isFinite(entry.expiresAtMs))
      .sort((left, right) => left.expiresAtMs - right.expiresAtMs)[0]
    if (!deadline) return
    deadlineTimer = setTimeout(
      () => fail(new Error(`shared data resource ${deadline.kind} expired: ${resource}`)),
      Math.max(0, deadline.expiresAtMs - Date.now())
    )
    deadlineTimer.unref?.()
  }
  const setDeadline = (kind: 'lease' | 'commit', expiresAt?: string) => {
    if (expiresAt === undefined) {
      if (kind === 'commit') commitExpiresAtMs = undefined
      rescheduleDeadlineTimer()
      return
    }
    const expiresAtMs = Date.parse(expiresAt)
    if (!Number.isFinite(expiresAtMs)) {
      fail(new Error(`shared data resource ${kind} has invalid deadline: ${resource}`))
      return
    }
    if (kind === 'lease') leaseExpiresAtMs = expiresAtMs
    else commitExpiresAtMs = expiresAtMs
    rescheduleDeadlineTimer()
  }
  const assertCurrent = async () => {
    if (leaseLostError) throw leaseLostError
    try {
      await managerRequest(`${leasePath}/validate`, manager.token, fence)
    } catch (error) {
      const lost = new Error(`shared data resource lease was lost: ${resource}`, { cause: error })
      fail(lost)
      throw lost
    }
    if (leaseLostError) throw leaseLostError
  }
  const withCommit = async <R>(commit: (commitId?: string) => Promise<R>): Promise<R> => {
    if (leaseLostError) throw leaseLostError
    const inheritedCommitId = currentManagerDataCommitId()
    if (inheritedCommitId) return commit(inheritedCommitId)
    const commitId = randomUUID()
    const begun = RenewResultSchema.parse(await managerRequest(
      `${leasePath}/commits/${encodeURIComponent(commitId)}/begin`, manager.token, fence
    )).lease
    let commitRenewalInFlight = false
    const commitMaintenance = new Set<Promise<void>>()
    const commitTimer = setInterval(() => {
      if (stopped || leaseLostError || commitRenewalInFlight) return
      commitRenewalInFlight = true
      const request = managerRequest(
        `${leasePath}/commits/${encodeURIComponent(commitId)}/renew`, manager.token, fence
      ).then((value) => {
        const renewed = RenewResultSchema.parse(value).lease
        if (renewed.commitExpiresAt) setDeadline('commit', renewed.commitExpiresAt)
      }).catch((error) => {
        if (isManagerConflict(error)) {
          fail(new Error(`shared data resource commit fence was lost: ${resource}`, { cause: error }))
        }
      }).finally(() => {
        commitRenewalInFlight = false
        commitMaintenance.delete(request)
      })
      commitMaintenance.add(request)
    }, 3_000)
    commitTimer.unref?.()
    if (begun.commitExpiresAt) setDeadline('commit', begun.commitExpiresAt)
    try {
      return await runWithManagerDataCommitId(commitId, () => commit(commitId))
    } finally {
      clearInterval(commitTimer)
      await Promise.allSettled([...commitMaintenance])
      setDeadline('commit')
      await managerRequest(
        `${leasePath}/commits/${encodeURIComponent(commitId)}/end`, manager.token, fence
      ).catch(() => undefined)
    }
  }
  const context: ManagerDataMutexOperationContext = {
    resource,
    signal: controller.signal,
    fence,
    assertCurrent,
    withCommit
  }
  setDeadline('lease', acquired.expiresAt)

  const renewTimer = setInterval(() => {
    if (stopped || leaseLostError || renewalInFlight) return
    renewalInFlight = true
    const request = managerRequest(`${leasePath}/renew`, manager.token, fence)
      .then((value) => {
        if (stopped || leaseLostError) return
        setDeadline('lease', RenewResultSchema.parse(value).lease.expiresAt)
      })
      .catch((error) => {
        if (isManagerConflict(error)) {
          fail(new Error(`shared data resource lease was lost: ${resource}`, { cause: error }))
          return
        }
        console.warn(
          `[kun] shared data lease renewal delayed resource=${resource}: ` +
          `${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        renewalInFlight = false
        maintenance.delete(request)
      })
    maintenance.add(request)
  }, 3_000)
  renewTimer.unref?.()

  const operationPromise = Promise.resolve().then(() =>
    runWithManagerDataMutexContext(context, () => operation(context)))
  operationPromise.catch(() => undefined)

  try {
    let result: T | undefined
    let operationRejected = false
    let operationError: unknown
    try {
      result = await Promise.race([operationPromise, leaseLost])
    } catch (error) {
      if (leaseLostError) {
        const cleanedUp = await Promise.race([
          operationPromise.then(() => true, () => true),
          delay(OPERATION_ABORT_GRACE_MS).then(() => false)
        ])
        if (!cleanedUp) {
          console.warn(`[kun] shared data operation did not stop after abort resource=${resource}`)
        }
        throw leaseLostError
      }
      operationRejected = true
      operationError = error
    }
    if (leaseLostError) throw leaseLostError
    if (operationRejected) throw operationError
    return result as T
  } finally {
    stopped = true
    clearInterval(renewTimer)
    if (deadlineTimer) clearTimeout(deadlineTimer)
    await Promise.allSettled([...maintenance])
    await managerRequest(`${leasePath}/release`, manager.token, fence).catch(() => undefined)
  }
}

function localContext(resource: string): ManagerDataMutexOperationContext {
  const controller = new AbortController()
  return {
    resource,
    signal: controller.signal,
    assertCurrent: async () => undefined,
    withCommit: async (commit) => commit()
  }
}

function enqueueLocal<T>(resource: string, operation: () => Promise<T>): Promise<T> {
  const previous = localQueues.get(resource) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const guard = run.then(() => undefined, () => undefined)
  localQueues.set(resource, guard)
  void guard.finally(() => {
    if (localQueues.get(resource) === guard) localQueues.delete(resource)
  })
  return run
}

function managerRuntimeIdentity(): {
  baseUrl: string
  token: string
  flavor: RuntimeFlavor
  instanceId: string
} | null {
  const baseUrl = process.env.KUN_MANAGER_BASE_URL?.trim().replace(/\/+$/u, '')
  const token = process.env.KUN_MANAGER_TOKEN?.trim()
  const instanceId = process.env.KUN_RUNTIME_INSTANCE_ID?.trim()
  const flavor = RuntimeFlavorSchema.safeParse(process.env.KUN_RUNTIME_FLAVOR?.trim())
  if (!baseUrl || !token || !instanceId || !flavor.success) return null
  return { baseUrl, token, instanceId, flavor: flavor.data }
}

class ManagerConflictError extends Error {}

async function managerRequest(url: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const message = `Kun Service Manager data mutex failed with HTTP ${response.status}: ${detail.slice(0, 512)}`
    if (response.status === 409) throw new ManagerConflictError(message)
    throw new Error(message)
  }
  return response.json()
}

function isManagerConflict(error: unknown): error is ManagerConflictError {
  return error instanceof ManagerConflictError
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
