import { createHash } from 'node:crypto'
import type { TurnService } from './turn-service-core.js'
import { TurnConflictError } from './turn-service-core.js'
import type { Turn } from '../contracts/turns.js'
import { makeUserItem } from '../domain/item.js'
import { finishTurn } from '../domain/turn.js'
import { validateAndBindImageSteeringAttachments } from '../loop/turn-steering-attachments.js'

export type DurableSteerInput = {
  threadId: string; turnId: string; operationId: string; sourceTurnId?: string
  text: string; displayText?: string; attachmentIds?: string[]
}

function bytes(entry: { text: string; displayText?: string; attachmentIds?: string[] }): number {
  return Buffer.byteLength(entry.text + (entry.displayText ?? '') + (entry.attachmentIds ?? []).join(''), 'utf8')
}

function compatible(source: Turn, target: Turn): boolean {
  return ['mode', 'agentSurface', 'designProfile', 'designDocumentTarget', 'approvalPolicy',
    'sandboxMode', 'approvalReviewer'].every((key) =>
    JSON.stringify(source[key as keyof Turn] ?? null) === JSON.stringify(target[key as keyof Turn] ?? null)) &&
    !source.writeContext && !source.guiDesignArtifact && !source.composerContexts?.length
}

/** Queue promotion and ownership conversion use the same mutation/CAS boundary. */
export async function admitDurableSteering(service: TurnService, input: DurableSteerInput): Promise<void> {
  const release = service['deps'].steering.holdAdmission(input.turnId)
  const fingerprint = createHash('sha256').update(JSON.stringify({
    text: input.text, displayText: input.displayText ?? null,
    attachmentIds: input.attachmentIds ?? [], sourceTurnId: input.sourceTurnId ?? null
  })).digest('hex')
  try {
    await service['withQueueDataMutation'](input.threadId, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const thread = await service['deps'].threadStore.get(input.threadId)
        const target = thread?.turns.find((turn) => turn.id === input.turnId)
        if (!thread || !target) throw new TurnConflictError('steering_target_missing')
        const existing = target.steeringDeliveries?.find((entry) => entry.operationId === input.operationId)
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new TurnConflictError('steering_operation_conflict')
          return
        }
        if (target.status !== 'running' || !service.isTurnExecutionActive(target.id)) {
          throw new TurnConflictError('steering_target_inactive')
        }
        if (service['deps'].steering.isSealed(target.id)) throw new TurnConflictError('steering_target_closed')
        const source = input.sourceTurnId ? thread.turns.find((turn) => turn.id === input.sourceTurnId) : undefined
        if (input.sourceTurnId && (!source || source.status !== 'queued' || source.admissionPending)) {
          throw new TurnConflictError('steering_source_not_queued')
        }
        if (source && (!compatible(source, target) ||
          JSON.stringify([...(source.attachmentIds ?? [])].sort()) !== JSON.stringify([...(input.attachmentIds ?? [])].sort()))) {
          throw new TurnConflictError('steering_routing_mismatch')
        }
        const receipts = target.steeringDeliveries ?? []
        const volatile = service['deps'].steering.peek(target.id)
        if (receipts.length >= 256 || receipts.filter((entry) => !entry.delivered).length + volatile.length >= 32 ||
          bytes(input) + [...receipts.filter((entry) => !entry.delivered), ...volatile]
            .reduce((total, entry) => total + bytes(entry), 0) > 64 * 1024) {
          throw new TurnConflictError('steering_capacity')
        }
        const attachmentIds = await validateAndBindImageSteeringAttachments({
          attachmentIds: input.attachmentIds ?? [], turn: target,
          steeringEntries: [...receipts, ...volatile,
            { attachmentIds: service['deps'].steering.drainedAttachmentIds(target.id) },
            { attachmentIds: input.attachmentIds ?? [] }],
          attachmentStore: service['deps'].attachmentStore?.(), threadId: input.threadId, workspace: thread.workspace
        })
        const createdAt = service['deps'].nowIso()
        const itemId = `item_steered_${createHash('sha256').update(`${target.id}:${input.operationId}`).digest('hex')}`
        const receipt = { operationId: input.operationId, itemId, fingerprint,
          sourceTurnId: input.sourceTurnId, text: input.text, displayText: input.displayText,
          attachmentIds, createdAt, delivered: false }
        const turns = thread.turns.map((turn) => turn.id === target.id
          ? { ...turn, steeringDeliveries: [...receipts, receipt] }
          : turn.id === source?.id
            ? { ...finishTurn(turn, 'aborted', createdAt), steeredToTurnId: target.id, terminalCode: 'queue_steered' }
            : turn)
        service['deps'].steering.markDurablePending(target.id)
        const committed = await service['commitThreadRecordCAS']({ ...thread, turns, updatedAt: createdAt }, thread.revision ?? 0)
        if (!committed.applied) continue
        return
      }
      throw new TurnConflictError('steering_concurrent_change')
    })
  } finally { release() }
}

/** Replaying a receipt uses the same item id; session stores upsert by id. */
export async function flushDurableSteering(service: TurnService, threadId: string, turnId: string): Promise<void> {
  await service['withQueueDataMutation'](threadId, async () => {
    const thread = await service['deps'].threadStore.get(threadId)
    const turn = thread?.turns.find((entry) => entry.id === turnId)
    if (!thread || !turn) { service['deps'].steering.clearDurablePending(turnId); return }
    for (const entry of turn.steeringDeliveries ?? []) {
      if (entry.delivered) continue
      const item = { ...makeUserItem({ id: entry.itemId, threadId, turnId, text: entry.text,
        displayText: entry.displayText, attachmentIds: entry.attachmentIds }), createdAt: entry.createdAt }
      await service['deps'].sessionStore.appendItem(threadId, item)
      await service['deps'].events.record({ kind: 'item_created', threadId, turnId, itemId: item.id, item })
    }
    if (turn.steeringDeliveries?.some((entry) => !entry.delivered)) {
      const deliveredIds = new Set(turn.steeringDeliveries.filter((entry) => !entry.delivered).map((entry) => entry.itemId))
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await service['deps'].threadStore.get(threadId)
        if (!current) break
        const next = { ...current, turns: current.turns.map((candidate) => candidate.id === turnId
          ? { ...candidate, steeringDeliveries: candidate.steeringDeliveries?.map((entry) => deliveredIds.has(entry.itemId)
            ? { ...entry, text: '', displayText: undefined, delivered: true } : entry) }
          : candidate) }
        if ((await service['commitThreadRecordCAS'](next, current.revision ?? 0)).applied) break
        if (attempt === 2) throw new TurnConflictError('steering_concurrent_change')
      }
    }
    service['deps'].steering.clearDurablePending(turnId)
  })
}
