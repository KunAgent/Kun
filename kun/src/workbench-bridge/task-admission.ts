import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { isWorkbenchTerminal } from '../contracts/workbench-links.js'
import { TurnConflictError } from '../services/turn-service.js'
import type { WorkbenchBridge } from './bridge.js'
import { readWorkbenchLink, updateWorkbenchLink } from './link-store.js'

const sameAdmission = (current: WorkbenchLink, expected: WorkbenchLink, requestId: string) =>
  current.threadId === expected.threadId && (current.dispatchReplacementCount ?? 0) === (expected.dispatchReplacementCount ?? 0) &&
  (!current.clientRequestId || current.clientRequestId === requestId)

/**
 * The durable claim and the cancellation marker serialize through the link CAS.
 * A cancellation before the claim prevents enqueue; one after it must reconcile
 * the same request until its receipt is known, even across a runtime restart.
 */
export async function claimWorkbenchAdmission(bridge: WorkbenchBridge, link: WorkbenchLink, clientRequestId: string): Promise<boolean> {
  if (await reconcileWorkbenchCancellation(bridge, link)) return false
  let claimed = false
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => {
    claimed = false
    if (!sameAdmission(current, link, clientRequestId) || current.status !== 'queued' || current.cancelRequested ||
      current.userTookOver || current.admissionAttempted || current.turnId) return null
    claimed = true
    return { admissionAttempted: true, clientRequestId }
  })
  return claimed
}

/** Persist a late receipt before stopping it; never revive a cancelled card. */
export async function recordWorkbenchAdmission(bridge: WorkbenchBridge, link: WorkbenchLink, clientRequestId: string, turnId: string): Promise<void> {
  let recorded = false
  const current = await updateWorkbenchLink(bridge.store, link.roomId, link.id, (latest) => {
    recorded = false
    if (!sameAdmission(latest, link, clientRequestId)) return null
    recorded = true
    return { turnId, clientRequestId, status: latest.cancelRequested ? 'recovery_required' : 'queued' }
  })
  if (recorded) {
    bridge.wake()
    await reconcileWorkbenchCancellation(bridge, current)
  }
}

/** True means this link is owned by cancellation and must never admit more work. */
export async function reconcileWorkbenchCancellation(bridge: WorkbenchBridge, snapshot: WorkbenchLink): Promise<boolean> {
  let link = await readWorkbenchLink(bridge.store, snapshot.roomId, snapshot.id)
  if (!link.cancelRequested && link.dispatchIntentId && bridge.agentDispatch) {
    const intent = await bridge.agentDispatch.get(link.dispatchIntentId)
    if (intent?.cancellationRequested || intent?.state === 'cancelled') {
      link = await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ cancelRequested: true }))
    }
  }
  if (!link.cancelRequested) return false
  if (link.taskWorkspaceId && bridge.taskWorkspaces) {
    try { bridge.taskWorkspaces.cancel(link.taskWorkspaceId) } catch { /* Already settled. */ }
  }
  const readTurn = async () => {
    const thread = link.threadId ? await bridge.deps.threads.getMetadata(link.threadId) : null
    return thread?.turns.find((turn) => turn.id === link.turnId || Boolean(link.clientRequestId && turn.clientRequestId === link.clientRequestId))
  }
  let turn = await readTurn()
  if (turn?.status === 'queued' || turn?.status === 'running') {
    // Interrupt handles either status under the turn mutation fence, including
    // a queued turn promoted between the observation and the stop request.
    try { await bridge.deps.turns.interruptTurn({ threadId: link.threadId!, turnId: turn.id }) } catch (error) {
      if (!(error instanceof TurnConflictError)) throw error
    }
    turn = await readTurn()
  }
  const turnId = turn?.id ?? link.turnId
  if (turnId && bridge.deps.stopBackgroundExecution) await bridge.deps.stopBackgroundExecution(link.threadId!, turnId)
  const proveStopped = bridge.deps.proveTurnStopped ?? bridge.deps.proveStopped
  const stopped = turnId && (turn ? ['completed', 'failed', 'aborted'].includes(turn.status) : Boolean(proveStopped)) &&
    (!proveStopped || await proveStopped(link.threadId!, turnId))
  const knownAbsent = !turn && !link.turnId && !link.admissionAttempted
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => {
    // A receipt can arrive during the lookup. Reconcile again instead of
    // declaring absence using an older snapshot of the admission claim.
    if (knownAbsent && (current.admissionAttempted || current.turnId)) return null
    if (stopped || knownAbsent) return current.status === 'cancelled' && !current.error ? null :
      { status: 'cancelled', ...(turnId ? { turnId } : {}), attention: undefined, error: undefined }
    if (isWorkbenchTerminal(current.status) || current.status === 'queued' && !current.turnId) {
      return { status: 'recovery_required', ...(turn ? { turnId: turn.id } : {}),
        error: 'Stopping the task; its exact admission is still being reconciled.' }
    }
    return turn && current.turnId !== turn.id ? { turnId: turn.id } : null
  })
  return true
}
