import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  ThreadExecutionLease,
  TurnMutationFence
} from '../contracts/runtime-flavor.js'
import { mutationThreadId, mutationTurnId } from './shared-data-store-contracts.js'

const storage = new AsyncLocalStorage<TurnMutationFence>()
const activeByThread = new Map<string, ThreadExecutionLease>()
const activeByTurn = new Map<string, ThreadExecutionLease>()

export function rememberTurnLease(lease: ThreadExecutionLease): void {
  activeByThread.set(lease.threadId, lease)
  activeByTurn.set(lease.turnId, lease)
}

export function forgetTurnLease(lease: ThreadExecutionLease): void {
  if (activeByThread.get(lease.threadId)?.fencingToken === lease.fencingToken) {
    activeByThread.delete(lease.threadId)
  }
  if (activeByTurn.get(lease.turnId)?.fencingToken === lease.fencingToken) {
    activeByTurn.delete(lease.turnId)
  }
}

export function currentTurnMutationFence(): TurnMutationFence | undefined {
  return storage.getStore()
}

export function runWithTurnMutationFence<T>(
  fence: TurnMutationFence,
  operation: () => T
): T {
  return storage.run(toFence(fence), operation)
}

export function mutationFenceForValue(value: unknown): TurnMutationFence | undefined {
  const contextual = currentTurnMutationFence()
  const threadId = mutationThreadId(value) ?? undefined
  const turnId = mutationTurnId(value) ?? undefined
  if (contextual && fenceMatchesTarget(contextual, threadId, turnId)) return contextual
  if (turnId) return optionalFence(activeByTurn.get(turnId))
  return threadId ? optionalFence(activeByThread.get(threadId)) : undefined
}

export function fenceMatchesMutationValue(
  fence: TurnMutationFence,
  value: unknown
): boolean {
  const threadId = mutationThreadId(value)
  const turnId = mutationTurnId(value)
  return Boolean(threadId && fenceMatchesTarget(fence, threadId, turnId ?? undefined))
}

function fenceMatchesTarget(
  fence: TurnMutationFence,
  threadId: string | undefined,
  turnId: string | undefined
): boolean {
  return Boolean(threadId && fence.threadId === threadId && (!turnId || fence.turnId === turnId))
}

function optionalFence(lease: ThreadExecutionLease | undefined): TurnMutationFence | undefined {
  return lease ? toFence(lease) : undefined
}

function toFence(lease: TurnMutationFence): TurnMutationFence {
  return {
    threadId: lease.threadId,
    turnId: lease.turnId,
    ownerFlavor: lease.ownerFlavor,
    ownerInstanceId: lease.ownerInstanceId,
    fencingToken: lease.fencingToken
  }
}
