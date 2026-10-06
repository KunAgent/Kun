import { createHash } from 'node:crypto'
import type { RoomMessage, RoomMember } from '../contracts/rooms.js'
import { RoomDeliverySchema, type RoomReview } from '../contracts/room-deliveries.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { MemorySourceEvidence } from '../contracts/memory.js'
import type { RoomRequestState, RoomRuntimeDeps, RoomTaskExecution } from '../rooms/room-runtime-types.js'
import { boundedRoomText } from '../rooms/room-context.js'
import type { AgentMemoryCapture } from './agent-memory-capture-types.js'

/** Only stored host execution receipts may claim observed success. Delivery prose is a claim. */
export async function collectAgentMemoryEvidence(deps: RoomRuntimeDeps, job: AgentMemoryCapture) {
  const sources: MemorySourceEvidence[] = []
  const texts: Array<{ id: string; author: string; text: string; trust: string; outcome?: string }> = []
  const capturedTasks: string[] = [], capturedReviews: string[] = []
  let actorHint: RoomMember | undefined
  const request = await deps.store.get<RoomRequestState>('request', job.rootRequestId)
  const add = (id: string, text: string, kind: MemorySourceEvidence['kind'], locator: string, author: string,
    metadata: Partial<MemorySourceEvidence> = {}) => {
    if (sources.length >= 8 || sources.some((source) => source.id === id)) return false
    const trust = kind === 'user' ? 'explicit-user' : kind === 'tool' ? 'observed' : 'inferred'
    const sourceId = id.length <= 128 ? id : 'src_' + createHash('sha256').update(id).digest('hex').slice(0, 24)
    sources.push({ id: sourceId, kind, locator, threadId: job.rootRequestId, itemId: id, excerpt: text.slice(0, 512),
      contentHash: createHash('sha256').update(text).digest('hex'), trust, ...metadata })
    texts.push({ id: sourceId, author, trust, outcome: metadata.outcome, text: boundedRoomText(text, kind === 'user' ? 2000 : 1000) })
    return true
  }
  const user = request?.value.sourceMessageId ? await deps.store.get<RoomMessage>('message', request.value.sourceMessageId) : null
  if (user?.roomId === job.roomId && (user.value.authorKind === 'user' || job.handoffId)) {
    add(user.id, user.value.body, user.value.authorKind === 'user' ? 'user' : 'inference',
      `room:${job.roomId}/message:${user.id}`, user.value.authorKind === 'user' ? 'user' : 'handoff claim')
  }
  // Receipts have priority over assistant prose so a long conversation cannot crowd them out.
  for (const id of job.taskIds.slice(-2)) {
    const task = await deps.store.get<RoomTaskExecution>('task', id)
    if (!task || task.roomId !== job.roomId || task.value.task.memberSnapshot.participantAgentId !== job.participantAgentId) continue
    const raw = task.value.task.latestDeliveryId ? await deps.store.get('delivery', task.value.task.latestDeliveryId) : null
    const delivery = RoomDeliverySchema.safeParse(raw?.value)
    if (raw?.roomId !== job.roomId || !delivery.success) continue
    actorHint = task.value.task.memberSnapshot
    const value = delivery.data
    const locator = `room:${job.roomId}/task:${id}/delivery:${raw.id}`
    const terminalOutcome = task.value.task.status === 'failed' ? 'failed' :
      ['cancelled', 'aborted'].includes(task.value.task.status) ? 'aborted' : undefined
    const verification = value.verification.map((receipt, index) => ({ receipt, index }))
      .sort((a, b) => Number(b.receipt.status !== 'passed') - Number(a.receipt.status !== 'passed'))
    for (const { receipt, index } of verification.slice(0, 2)) {
      const receiptId = `${raw.id}:verification:${index}`
      const outcome = terminalOutcome ?? (receipt.status === 'passed' ? 'succeeded' :
        receipt.status === 'failed' || receipt.status === 'timed_out' ? 'failed' : 'unknown')
      add(receiptId, JSON.stringify(receipt), 'tool', locator + `/verification:${index}`, 'execution receipt', {
        receiptId, repositorySha: value.versionHash, artifactIds: receipt.logArtifactId ? [receipt.logArtifactId] : [], outcome
      })
    }
    if (add(raw.id, `Task state: ${task.value.task.status}\n${value.summary}\nLimitations: ${value.incomplete.join('; ')}`,
      'inference', locator, 'delivery claim', { repositorySha: value.versionHash, artifactIds: [value.diffArtifactId] })) capturedTasks.push(id)
  }
  for (const id of (job.reviewIds ?? []).slice(-2)) {
    const review = await deps.store.get<RoomReview>('review', id)
    const task = review ? await deps.store.get<RoomTaskExecution>('task', review.value.taskId) : null
    if (!review || review.roomId !== job.roomId || task?.value.reviewer?.participantAgentId !== job.participantAgentId) continue
    actorHint = task.value.reviewer
    if (add(id, JSON.stringify({ verdict: review.value.verdict, version: review.value.versionHash,
      findings: review.value.findings.slice(0, 4), limitations: review.value.limitations.slice(0, 2) }),
    'inference', `room:${job.roomId}/task:${review.value.taskId}/review:${id}`, 'review opinion',
    { repositorySha: review.value.versionHash })) capturedReviews.push(id)
  }
  for (const id of job.messageIds.slice(-6)) {
    const message = await deps.store.get<RoomMessage>('message', id)
    if (!message || message.roomId !== job.roomId || message.value.status !== 'final' ||
      message.value.authorAgentId !== job.participantAgentId || message.value.handoffId && message.value.handoffId !== job.handoffId) continue
    const run = message.value.originRunId ? await deps.store.get<RoomRunRecord>('room_run', message.value.originRunId) : null
    if (run && ['failed', 'cancelled'].includes(run.value.status)) {
      add(run.id, `Execution ${run.value.status}: ${run.value.reason ?? run.value.error ?? 'No successful execution receipt'}`,
        'tool', `room:${job.roomId}/run:${run.id}`, 'execution receipt', {
          receiptId: run.id, outcome: run.value.status === 'cancelled' ? 'aborted' : 'failed',
          ...(run.value.threadId ? { threadId: run.value.threadId, turnId: run.value.turnId } : {})
        })
    }
    add(id, message.value.body, 'inference', `room:${job.roomId}/message:${id}`, message.value.authorLabelSnapshot,
      run?.value.threadId ? { threadId: run.value.threadId, turnId: run.value.turnId } : {})
  }
  return { sources, texts, capturedTasks, capturedReviews, actorHint, request }
}
