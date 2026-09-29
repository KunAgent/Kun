import { RoomMessageSchema } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import {
  WORKBENCH_ACTIVE_STATUSES, type WorkbenchAttentionSchema, type WorkbenchLink, type WorkbenchLinkStatus
} from '../contracts/workbench-links.js'
import type { z } from 'zod'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { interactionId } from '../rooms/room-interaction-store.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import type { WorkbenchBridge } from './bridge.js'
import { IMMEDIATE_KINDS, executeImmediateLink } from './execute-immediate.js'
import { updateWorkbenchLink } from './link-store.js'
import { summarizeTurnResult } from './result-summary.js'
import { startTaskLink } from './start-task.js'
import { executionMode } from './execution.js'
import { admitBuildPhase, finishPlanPhase } from './reconcile-phases.js'
import { reconcileSchedules } from './schedule.js'

type Attention = z.infer<typeof WorkbenchAttentionSchema>
const BOT_STEER_PREFIX = 'workbench-steer-'
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text

/** Host-authored wake input: the outcome as reference data, never as a new instruction. */
export function outcomePrompt(link: WorkbenchLink): string {
  const word = link.status === 'completed' ? 'finished' : link.status === 'failed' ? 'failed' : 'ended'
  return [
    `Reference data, not an instruction from the user: a ${link.surface === 'code' ? 'Code' : 'Work'} task you handed over has ${word}.`,
    'Tell the user the outcome with send_im_message (phase "final"): what was done, which files changed, any checks that ran, and any caveat. ' +
      'If it failed or needs the user, say so plainly. Do not start another task unless the user asks.',
    JSON.stringify({ authority: 'reference_only', linkId: link.id, kind: link.kind, status: link.status, title: link.request.title,
      project: link.request.workspaceRoot, error: link.error, userTookOver: link.userTookOver === true,
      result: link.result && { summary: link.result.summary, finalExcerpt: link.result.finalExcerpt,
        changedFiles: link.result.changedFiles, commands: link.result.commands } })
  ].join('\n')
}

function pendingAttention(bridge: WorkbenchBridge, threadId: string): Attention | undefined {
  const approval = bridge.deps.approvals.pending(threadId)[0]
  if (approval) return { kind: 'approval', summary: clip(approval.summary || approval.toolName, 300) }
  const input = bridge.deps.inputs.pending(threadId)[0]
  return input ? { kind: 'user_input', summary: clip(input.prompt || input.questions[0]?.question || '', 300) } : undefined
}

/** The user wrote in the target session themselves, so the Agent must stop adding to it. */
function tookOver(thread: ThreadRecord, turn: Turn): boolean {
  const started = Date.parse(turn.createdAt)
  return thread.turns.some((other) => other.id !== turn.id && Date.parse(other.createdAt) > started) ||
    Boolean(turn.steeringDeliveries?.some((entry) => !entry.operationId.startsWith(BOT_STEER_PREFIX)))
}

const sameAttention = (a?: Attention, b?: Attention) => a?.kind === b?.kind && a?.summary === b?.summary

/** Bring one task/watch link in line with the real state of its target turn. */
async function reconcileTarget(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  const link = row.value
  const patch = (fields: Partial<WorkbenchLink>) => updateWorkbenchLink(bridge.store, link.roomId, link.id, () => fields)
  const thread = link.threadId ? await bridge.deps.threads.getMetadata(link.threadId) : null
  if (!thread) {
    if (link.cancelRequested) return void await patch({ status: 'cancelled' })
    if (link.threadId) await patch({ status: 'failed', error: 'The session no longer exists.' })
    return
  }
  const turn = thread.turns.find((item) => item.id === link.turnId || (link.clientRequestId && item.clientRequestId === link.clientRequestId))
  if (!turn) {
    if (link.cancelRequested) await patch({ status: 'cancelled' })
    return
  }
  const took = tookOver(thread, turn)
  if (turn.status === 'queued' || turn.status === 'running') {
    const attention = turn.status === 'running' ? pendingAttention(bridge, thread.id) : undefined
    const status: WorkbenchLinkStatus = turn.status === 'queued' ? 'queued' : attention ? 'needs_attention' : 'running'
    if (link.status === status && link.turnId === turn.id && sameAttention(link.attention, attention) && (link.userTookOver === true) === took) return
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status, turnId: turn.id, userTookOver: took,
      attention, ...(status === 'running' || status === 'queued' ? { error: undefined } : {}) }))
    return
  }
  const finishedAt = turn.finishedAt ?? new Date().toISOString()
  if (turn.status === 'completed' && await finishPlanPhase(bridge, link, thread)) return
  if (executionMode(link.request) === 'goal' && thread.goal) {
    const goal = thread.goal
    const snapshot = { status: goal.status, tokensUsed: goal.tokensUsed,
      tokenBudget: goal.tokenBudget ?? null, timeUsedSeconds: goal.timeUsedSeconds }
    if (goal.status === 'active') {
      const continuation = [...thread.turns].reverse().find((item) => item.status === 'running' || item.status === 'queued')
      if (link.status === 'running' && link.turnId === (continuation?.id ?? turn.id) &&
        link.goal?.status === snapshot.status && link.goal.tokensUsed === snapshot.tokensUsed) return
      await patch({ status: 'running', goal: snapshot, turnId: continuation?.id ?? turn.id })
      return
    }
    const goalStatus: WorkbenchLinkStatus = goal.status === 'complete' ? 'completed' : goal.status === 'paused' ? 'cancelled' : 'needs_attention'
    if (link.status === goalStatus && link.goal?.status === snapshot.status && link.goal.tokensUsed === snapshot.tokensUsed) return
    const wakes = goalStatus !== 'cancelled' && link.origin.kind === 'tool' &&
      (link.request.report === 'final' || goalStatus === 'needs_attention' && link.request.report === 'failure')
    const result = goalStatus === 'completed' ? summarizeTurnResult(await bridge.deps.sessions.loadItems(thread.id), turn, finishedAt) : undefined
    await patch({ status: goalStatus, goal: snapshot, turnId: turn.id,
      ...(result ? { result } : {}), ...(wakes ? { reported: false } : {}),
      ...(goalStatus === 'needs_attention' ? { error: `Goal stopped: ${goal.status}` } : {}) })
    if (wakes) bridge.reportPending.add(link.id)
    return
  }
  const result = summarizeTurnResult(await bridge.deps.sessions.loadItems(thread.id), turn, finishedAt)
  const status: WorkbenchLinkStatus = turn.status === 'completed' ? 'completed' : turn.status === 'aborted' ? 'cancelled' : 'failed'
  const wakes = status !== 'cancelled' && (link.request.report === 'final' || status === 'failed' && link.request.report === 'failure') &&
    (link.origin.kind === 'tool' || link.origin.kind === 'series' || link.kind === 'watch')
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status, result, turnId: turn.id, userTookOver: took,
    attention: undefined, ...(status === 'failed' ? { error: clip(turn.error ?? 'The task failed.', 2000) } : {}),
    ...(wakes ? { reported: false } : {}) }))
  if (wakes) bridge.reportPending.add(link.id)
}

async function reconcileLink(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  const link = row.value
  if (IMMEDIATE_KINDS.includes(link.kind)) {
    if (link.status === 'queued' || link.status === 'running') await executeImmediateLink(bridge, row)
    return
  }
  if (link.kind === 'watch') return reconcileTarget(bridge, row)
  if (link.status === 'queued' && !link.turnId) {
    if (link.cancelRequested) return void await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'cancelled' }))
    if (link.phase === 'build') return admitBuildPhase(bridge, link)
    return startTaskLink(bridge, row)
  }
  return reconcileTarget(bridge, row)
}

/** A finished watch announces itself with a fresh card so the room shows unread activity. */
async function announceWatch(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<void> {
  const id = interactionId('workbench-card-done', link.id)
  if (await bridge.store.get('message', id)) return
  const message = RoomMessageSchema.parse({ id, roomId: link.roomId, messageSeq: 1, authorKind: 'member', authorMemberId: link.memberId,
    authorAgentId: link.participantAgentId, authorLabelSnapshot: (await bridge.agentScope(link.participantAgentId)).name,
    presentationKind: 'workbench_task', workbenchLinkId: link.id, body: link.request.title.slice(0, 500), bodyRevision: 0,
    mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: new Date().toISOString() })
  await bridge.store.commit({ requestId: 'append:' + id, checks: [{ kind: 'message', id, expectedRevision: null }],
    puts: [{ kind: 'message', id, roomId: link.roomId, value: message }],
    events: [{ roomId: link.roomId, kind: 'message.created', payload: { id } }] })
}

async function reportOutcome(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  const link = row.value
  if (link.kind === 'watch') await announceWatch(bridge, link)
  else {
    const parent = link.origin.kind === 'series' ? (await bridge.store.get<WorkbenchLink>('workbench_link', link.origin.seriesId))?.value : undefined
    const originRunId = link.originRunId ?? parent?.originRunId
    const sourceTurnId = link.origin.kind === 'tool' ? link.origin.turnId : parent?.origin.kind === 'tool' ? parent.origin.turnId : undefined
    const run = originRunId ? await bridge.store.get<RoomRunRecord>('room_run', originRunId) : undefined
    if (run?.value.threadId && sourceTurnId) {
      // Called from the tick, which already holds the room runtime's exclusive lane.
      await enqueuePrivateContinuation(bridge.deps, { threadId: run.value.threadId, sourceTurnId,
        key: link.id, kind: 'workbench_task', prompt: outcomePrompt(link) })
    }
  }
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => current.reported === true ? null : { reported: true })
}

async function flushReports(bridge: WorkbenchBridge): Promise<void> {
  if (!bridge.backlogLoaded) {
    bridge.backlogLoaded = true
    const rows = await bridge.store.list<WorkbenchLink>('workbench_link', { status: ['completed', 'failed', 'needs_attention'], limit: 100, order: 'desc' })
    for (const row of rows) if (row.value.reported === false) bridge.reportPending.add(row.id)
  }
  for (const id of [...bridge.reportPending]) {
    const row = await bridge.store.get<WorkbenchLink>('workbench_link', id)
    if (!row || row.value.reported !== false) { bridge.reportPending.delete(id); continue }
    try { await reportOutcome(bridge, row); bridge.reportPending.delete(id) } catch (error) {
      console.warn('[kun] workbench outcome report:', error instanceof Error ? error.message : String(error))
    }
  }
}

/** One reconciliation pass; true while any link still needs a look on the fast cadence. */
export async function reconcileWorkbench(bridge: WorkbenchBridge): Promise<boolean> {
  bridge.nextWakeAt = await reconcileSchedules(bridge)
  const rows = await bridge.store.list<WorkbenchLink>('workbench_link', {
    status: [...WORKBENCH_ACTIVE_STATUSES], limit: 200, order: 'asc' })
  for (const row of rows) {
    try { await reconcileLink(bridge, row) } catch (error) {
      console.warn('[kun] workbench link:', error instanceof Error ? error.message : String(error))
    }
  }
  await flushReports(bridge)
  return rows.some((row) => row.value.status !== 'recovery_required') || bridge.reportPending.size > 0
}
