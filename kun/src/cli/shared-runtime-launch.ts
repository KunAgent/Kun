import type { ChildProcess } from 'node:child_process'
import { RuntimeInfoResponse } from '../contracts/runtime-info.js'
import type { RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { sameCanonicalPath } from '../manager/canonical-path.js'
import type { SharedRuntimeConnection } from './shared-runtime.js'
import { processAlive, safeDiscoveryUrl } from './shared-runtime-support.js'

const CANDIDATE_STOP_GRACE_MS = 5_000
const CANDIDATE_STOP_FORCE_MS = 5_000

export type SharedRuntimeLaunchObservation<Value> =
  | { kind: 'ready'; value: Value; ownerPid: number }
  | { kind: 'starting' }
  | { kind: 'vacant' }
  | { kind: 'blocked'; error: Error }

export async function probeRuntimeDiscovery(
  record: RuntimeDiscoveryRecord,
  expectedDataDir: string,
  fetchImpl: typeof fetch = fetch
): Promise<SharedRuntimeConnection | null> {
  if (!safeDiscoveryUrl(record) || !processAlive(record.pid)) return null
  try {
    const response = await fetchImpl(`${record.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: record.runtimeToken
        ? { authorization: `Bearer ${record.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const info = RuntimeInfoResponse.parse(await response.json())
    if (
      info.instanceId !== record.instanceId ||
      info.pid !== record.pid ||
      info.startedAt !== record.startedAt ||
      info.serviceVersion !== record.serviceVersion ||
      info.buildId !== record.buildId ||
      info.launchMode !== record.launchMode ||
      !sameCanonicalPath(info.dataDir, expectedDataDir)
    ) return null
    const activeTurnCount = parseNonnegativeIntegerHeader(
      response.headers.get('x-kun-active-turn-count')
    )
    const managerProtocolVersion = parsePositiveIntegerHeader(
      response.headers.get('x-kun-manager-protocol-version')
    )
    return {
      discovery: record,
      info,
      ...(activeTurnCount !== undefined ? { activeTurnCount } : {}),
      ...(managerProtocolVersion !== undefined ? { managerProtocolVersion } : {})
    }
  } catch {
    return null
  }
}

type LaunchWaitInput<Value> = {
  deadline: number
  pollMs: number
  observe: () => Promise<SharedRuntimeLaunchObservation<Value>>
  timeoutError: () => Error
}

/** Wait for an already elected compatible owner to publish readiness. */
export async function waitForStartingSharedRuntime<Value>(
  input: LaunchWaitInput<Value>
): Promise<{ kind: 'ready'; value: Value } | { kind: 'vacant' }> {
  for (;;) {
    const observation = await input.observe()
    if (observation.kind === 'ready') {
      return { kind: 'ready', value: observation.value }
    }
    if (observation.kind === 'vacant') return observation
    if (observation.kind === 'blocked') throw observation.error
    if (Date.now() >= input.deadline) throw input.timeoutError()
    await delayWithinDeadline(input.deadline, input.pollMs)
  }
}

/**
 * Wait for one exact detached candidate without leaking it on any failed path.
 * If that candidate loses election and exits, a compatible starting owner may
 * still finish publication within the original launch budget.
 */
export async function waitForSpawnedSharedRuntime<Value>(
  input: LaunchWaitInput<Value> & { child: ChildProcess; allowWinningOwner?: boolean }
): Promise<Value> {
  let spawnError: Error | null = null
  const onError = (error: Error): void => { spawnError = error }
  input.child.once('error', onError)
  try {
    for (;;) {
      let observation = await input.observe()
      if (observation.kind === 'ready') {
        return acceptSpawnedRuntimeReady(input, observation)
      }
      if (observation.kind === 'blocked') throw observation.error

      if (spawnError || childExited(input.child)) {
        // Registration conflict is reported by the child just after the winning
        // owner becomes visible. Re-read once so that boundary cannot turn a
        // valid attach into a false startup failure.
        observation = await input.observe()
        if (observation.kind === 'ready') {
          return acceptSpawnedRuntimeReady(input, observation)
        }
        if (observation.kind === 'starting') {
          if (Date.now() >= input.deadline) throw input.timeoutError()
          await delayWithinDeadline(input.deadline, input.pollMs)
          continue
        }
        if (observation.kind === 'blocked') throw observation.error
        throw spawnError ?? candidateExitError(input.child)
      }

      if (Date.now() >= input.deadline) throw input.timeoutError()
      await delayWithinDeadline(input.deadline, input.pollMs)
    }
  } catch (error) {
    try {
      await terminateSpawnedRuntime(input.child)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Kun shared runtime launch failed and its exact candidate could not be terminated'
      )
    }
    throw error
  } finally {
    input.child.removeListener('error', onError)
  }
}

async function acceptSpawnedRuntimeReady<Value>(
  input: { child: ChildProcess; allowWinningOwner?: boolean },
  observation: Extract<SharedRuntimeLaunchObservation<Value>, { kind: 'ready' }>
): Promise<Value> {
  if (observation.ownerPid !== input.child.pid) {
    await terminateSpawnedRuntime(input.child)
    if (input.allowWinningOwner === false) {
      throw new Error(`another Runtime process ${observation.ownerPid} won client-owned startup`)
    }
  }
  return observation.value
}

export async function terminateSpawnedRuntime(child: ChildProcess): Promise<void> {
  if (childExited(child)) return
  try {
    child.kill('SIGTERM')
  } catch {
    // The process may have crossed the exit boundary before signaling.
  }
  if (await waitForChildExit(child, CANDIDATE_STOP_GRACE_MS)) return
  try {
    child.kill('SIGKILL')
  } catch {
    // Re-check below; a failed signal is harmless only when the child exited.
  }
  if (await waitForChildExit(child, CANDIDATE_STOP_FORCE_MS)) return
  throw new Error(`Kun shared runtime candidate PID ${child.pid ?? 'unknown'} remained alive`)
}

function childExited(child: ChildProcess): boolean {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null
}

function parsePositiveIntegerHeader(value: string | null): number | undefined {
  const parsed = parseNonnegativeIntegerHeader(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function parseNonnegativeIntegerHeader(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function candidateExitError(child: ChildProcess): Error {
  const detail = child.signalCode
    ? `signal ${child.signalCode}`
    : child.exitCode !== null
      ? `code ${child.exitCode}`
      : 'a process error'
  return new Error(`Kun shared runtime candidate exited during startup with ${detail}`)
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    const onError = (): void => finish(childExited(child))
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function delayWithinDeadline(deadline: number, pollMs: number): Promise<void> {
  const remaining = Math.max(0, deadline - Date.now())
  if (remaining === 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)))
}
