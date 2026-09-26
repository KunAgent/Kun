import { z } from 'zod'
import { RoomIdSchema } from '../contracts/rooms.js'

export const RoomDispatchIntentSchema = z.object({
  id: RoomIdSchema,
  roomId: RoomIdSchema,
  taskId: RoomIdSchema,
  stepId: RoomIdSchema,
  attemptId: RoomIdSchema,
  threadId: z.string().min(1).max(256),
  clientRequestId: RoomIdSchema,
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['pending', 'admitted', 'recovery_required']),
  turnId: z.string().min(1).max(256).optional(),
  error: z.string().max(4000).optional(),
  revision: z.number().int().nonnegative()
}).strict().refine((intent) => intent.state !== 'admitted' || Boolean(intent.turnId?.trim()),
  'admitted intent requires a turn identity')
export type RoomDispatchIntent = z.infer<typeof RoomDispatchIntentSchema>

export interface RoomDispatchPort {
  load(id: string): Promise<RoomDispatchIntent | null>
  /** Implemented with Manager CAS and the active runtime fencing token. */
  save(intent: RoomDispatchIntent, expectedRevision: number): Promise<void>
  assertOwnership(): Promise<void>
}
export interface RoomTurnAdmissionPort {
  /** Both operations must be durable and idempotent for the supplied identity. */
  ensureThread(intent: RoomDispatchIntent): Promise<void>
  enqueue(intent: RoomDispatchIntent): Promise<{ turnId: string }>
  findAdmission(intent: RoomDispatchIntent): Promise<
    | { status: 'found'; turnId: string; requestFingerprint: string }
    | { status: 'absent' }
    | { status: 'unknown' }
  >
}

/**
 * Reconciles the room/thread commit gap without executing an agent loop.
 * Transport uncertainty always queries the original request identity first.
 */
export class RoomDispatchReconciler {
  private readonly inflight = new Map<string, Promise<RoomDispatchIntent>>()
  constructor(private readonly store: RoomDispatchPort, private readonly turns: RoomTurnAdmissionPort) {}

  dispatch(id: string): Promise<RoomDispatchIntent> {
    const previous = this.inflight.get(id)
    if (previous) return previous
    const run = this.reconcile(id)
    this.inflight.set(id, run)
    void run.finally(() => {
      if (this.inflight.get(id) === run) this.inflight.delete(id)
    }).catch(() => undefined)
    return run
  }

  private async reconcile(id: string): Promise<RoomDispatchIntent> {
    await this.store.assertOwnership()
    const loaded = await this.store.load(id)
    if (!loaded) throw new Error('room dispatch intent not found')
    const intent = RoomDispatchIntentSchema.parse(loaded)
    if (intent.state !== 'pending') return intent
    const observed = await this.turns.findAdmission(intent)
    if (observed.status === 'unknown') return this.requireRecovery(intent, 'admission cannot be determined')
    if (observed.status === 'found') {
      if (observed.requestFingerprint !== intent.requestFingerprint) {
        return this.requireRecovery(intent, 'admission fingerprint mismatch')
      }
      return this.admitted(intent, observed.turnId)
    }
    await this.store.assertOwnership()
    await this.turns.ensureThread(intent)
    await this.store.assertOwnership()
    try {
      const result = await this.turns.enqueue(intent)
      return await this.admitted(intent, result.turnId)
    } catch {
      // The enqueue or mapping ACK may have been lost after durable commit.
      // Never allocate a new identity or replay side effects in this catch.
      const latest = await this.store.load(id)
      if (latest?.state === 'admitted') return RoomDispatchIntentSchema.parse(latest)
      const admission = await this.turns.findAdmission(intent)
      if (admission.status === 'found' && admission.requestFingerprint === intent.requestFingerprint) {
        return this.admitted(intent, admission.turnId)
      }
      if (admission.status === 'absent') throw new Error('admission not committed; retry the same dispatch intent')
      return this.requireRecovery(intent, 'admission result requires reconciliation')
    }
  }

  private async admitted(intent: RoomDispatchIntent, turnId: string): Promise<RoomDispatchIntent> {
    await this.store.assertOwnership()
    const result = RoomDispatchIntentSchema.parse({ ...intent, state: 'admitted', turnId, revision: intent.revision + 1 })
    await this.store.save(result, intent.revision)
    return result
  }

  private async requireRecovery(intent: RoomDispatchIntent, error: string): Promise<RoomDispatchIntent> {
    await this.store.assertOwnership()
    const result: RoomDispatchIntent = { ...intent, state: 'recovery_required', error, revision: intent.revision + 1 }
    await this.store.save(result, intent.revision)
    return result
  }
}
