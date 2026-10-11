import { createHash } from 'node:crypto'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'
import type { RoomStore } from './room-store.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'

/** Bridges the shared runtime's persisted attention transitions into the
 * durable Rooms event stream. Publication already emits message events in
 * its transaction; approvals/structured input need this explicit wake-up. */
export class RoomNotificationObserver implements RuntimeEventObserver {
  constructor(private readonly deps: { threadStore: ThreadStore; store: RoomStore }) {}

  async record(event: RuntimeEvent): Promise<void> {
    if (event.kind !== 'approval_requested' && event.kind !== 'user_input_requested') return
    if (event.status !== 'pending') return
    // Agent-reviewed approvals are not a pending user decision.
    if (event.kind === 'approval_requested' && event.approvalReviewer === 'agent') return
    const id = 'approvalId' in event ? event.approvalId : event.inputId
    await this.enqueue(event.threadId, id, event.kind === 'approval_requested' ? 'approval' : 'input', event.turnId, event.timestamp)
  }

  async reconcile(gates: Pick<RoomRuntimeDeps, 'approvals' | 'inputs'>): Promise<void> {
    for (const gate of gates.approvals.pending()) {
      await this.enqueue(gate.threadId, gate.id, 'approval', gate.turnId, gate.createdAt)
    }
    for (const gate of gates.inputs.pending()) {
      await this.enqueue(gate.threadId, gate.id, 'input', gate.turnId)
    }
  }

  private async enqueue(threadId: string, id: string, gateKind: 'approval' | 'input', _turnId?: string, occurredAt?: string) {
    const thread = await this.deps.threadStore.get(threadId)
    const scope = thread?.roomContext
    if (!scope || scope.kind !== 'conversation') return
    const kind = gateKind === 'approval' ? 'approval_requested' : 'user_input_requested'
    const key = createHash('sha256').update(JSON.stringify([scope.roomId, threadId, kind, id])).digest('hex')
    if (await this.deps.store.getRequest('room-notification:' + key)) return
    await this.deps.store.commit({ requestId: 'room-notification:' + key,
      events: [{ roomId: scope.roomId, kind: 'notification.requested',
        payload: { id, threadId, gateKind, ...(occurredAt ? { occurredAt } : {}) } }]
    })
  }
}

/** Retry the observer's best-effort projection from current live gates on
 * startup/each Rooms tick. Never recreate a resolved/expired historical gate. */
export async function reconcileRoomNotificationGates(
  deps: Pick<RoomRuntimeDeps, 'threadStore' | 'store' | 'approvals' | 'inputs'>
): Promise<void> {
  await new RoomNotificationObserver(deps).reconcile(deps)
}
