import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { authorityFromTurn } from './permission-clamp.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'

/** Inputs a caller supplies to project a tool context from a live turn. */
export type ManagerToolContextInput = {
  threadId: string
  turnId: string
  workspace: string
  signal: AbortSignal
  awaitApproval: ManagerToolContext['awaitApproval']
  thread?: Pick<
    ThreadRecord,
    'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
  > | null
  turn?: Pick<
    Turn,
    'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'clientSurface' | 'imContext'
  > | null
}

/** Projects a `ManagerToolContext` from the calling turn (09 §4.2 ctx). */
export async function buildManagerToolContext(
  deps: Pick<ManagerRuntimeDeps, 'threads' | 'turns'>,
  input: ManagerToolContextInput
): Promise<ManagerToolContext> {
  const thread = input.thread ?? await deps.threads.get(input.threadId).catch(() => null)
  const turn = input.turn ?? await deps.turns.getTurn(input.threadId, input.turnId).catch(() => null)
  if (!thread) throw new Error(`manager thread ${input.threadId} not found`)
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    workspace: input.workspace,
    authority: authorityFromTurn(thread, turn ?? undefined),
    signal: input.signal,
    awaitApproval: input.awaitApproval
  }
}
