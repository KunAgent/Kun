import { ContinueCommitment, ContinueCommitmentResult, ManualFollowUpClaim, ManualFollowUpDispatch } from '../contracts/collaboration-followup-api.js'
import { CommitmentEffectSchema, CommitmentExecutionSchema, CommitmentExecutionPermitSchema, FollowUpReceiptSchema,
  type CommitmentExecutionPermit, type FollowUpReceipt } from '../contracts/collaboration-effects.js'
import type { NativeFollowUpAdmission } from '../contracts/native-followup-requests.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { NativeFollowUpPermitError, withNativeFollowUpWriteScope } from './native-followup-write-scope.js'
import { CollaborationQuerySchema, type CollaborationQuery } from '../contracts/collaboration-store.js'
import type { RoomMemoryErasure } from '../rooms/room-memory-erasure.js'
import type { RoomSidebarQuery, RoomSidebarPage } from '../contracts/room-sidebar.js'
import { z } from 'zod'
import {
  RoomStoredDocumentSchema,
  RoomStoreCommitResultSchema,
  RoomStoreConflictError,
  RoomStoreEventSchema,
  RoomStoreRequestSchema,
  type RoomDocumentKind,
  type RoomStoredDocument,
  type RoomStore,
  type RoomStoreCommit,
  type RoomStoreCommitResult,
  type RoomStoreEvent,
  type RoomStoreListOptions,
  type RoomStoreRequest,
  type RoomListOptions,
  type RoomListPage
} from '../rooms/room-store.js'
import { requestManagerJson, type ServiceManagerConnection } from './manager-client.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import { ServiceManagerHttpError } from './usage-errors.js'
import type { RoomOutcomeQuery } from '../rooms/room-store.js'
import type { RoomRequestOutcome } from '../contracts/rooms-product.js'
import { RoomLatestMessageSchema } from '../contracts/room-list.js'
import type { RoomReplyPage, RoomReplyPageInput } from '../contracts/room-replies.js'
import type { RoomSearchQuery, RoomSearchPage, RoomRepositoryChoice, RoomRunSummary, RoomRunSummaryQuery } from '../contracts/room-experience.js'
import { invalidateTickReads, tickCachedRead } from '../rooms/room-tick-reads.js'
import { notifyRoomStoreCommit } from '../rooms/room-commit-signal.js'
import { currentFollowUpArbitrationFence, mayChangeFollowUpAdmission, withFollowUpArbitration } from './followup-arbitration.js'

/** Runtime proxy. Canonical room data never opens a local file in this process. */
export class RemoteRoomStore implements RoomStore {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly options: {
      getFence?: () => ManagerResourceFence | undefined
      ready?: () => Promise<unknown>
    } = {}
  ) {}

  async get<T = unknown>(kind: RoomDocumentKind, id: string): Promise<RoomStoredDocument<T> | null> {
    return tickCachedRead(`get\0${kind}\0${id}`, async () =>
      RoomStoredDocumentSchema.nullable().parse(await this.call('get', { kind, id })) as RoomStoredDocument<T> | null)
  }

  async list<T = unknown>(kind: RoomDocumentKind, options: RoomStoreListOptions = {}): Promise<RoomStoredDocument<T>[]> {
    return tickCachedRead(`list\0${kind}\0${JSON.stringify(options)}`, async () =>
      z.array(RoomStoredDocumentSchema).parse(await this.call('list', { kind, options })) as RoomStoredDocument<T>[])
  }

  async collaborationQuery<T = unknown>(input: CollaborationQuery): Promise<RoomStoredDocument<T>[]> {
    const query = CollaborationQuerySchema.parse(input)
    return tickCachedRead(`collaboration\0${JSON.stringify(query)}`, async () =>
      z.array(RoomStoredDocumentSchema).parse(await this.call('collaborationQuery', query)) as RoomStoredDocument<T>[])
  }

  async commit(input: RoomStoreCommit): Promise<RoomStoreCommitResult> {
    invalidateTickReads()
    try {
      await this.options.ready?.()
      const fence = this.fence()
      const commit = async () => {
        const arbitration = currentFollowUpArbitrationFence()
        return RoomStoreCommitResultSchema.parse(await this.call('commit', {
          input, ...(fence ? { fence } : {}), ...(arbitration ? { arbitration } : {})
        }))
      }
      const result = fence && mayChangeFollowUpAdmission(input)
        ? await withFollowUpArbitration(commit, {
          baseUrl: this.manager.discovery.baseUrl, token: this.manager.discovery.managerToken,
          flavor: fence.ownerFlavor, instanceId: fence.ownerInstanceId
        }) : await commit()
      // A replay may be the first response after an ambiguous Manager connection loss.
      notifyRoomStoreCommit(input)
      return result
    } finally {
      invalidateTickReads()
    }
  }

  private async followUpMutation(operation: 'stageManualFollowUp' | 'claimManualFollowUp' | 'issueManualFollowUpPermit' |
    'beginManualFollowUpDispatch' | 'reconcileManualFollowUp', body: Record<string, unknown>): Promise<unknown> {
    const fence = this.options.getFence?.()
    if (!fence) throw new NativeFollowUpPermitError('rooms coordinator fence is required for manual follow-up')
    try {
      return await withFollowUpArbitration(async () => {
        const arbitration = currentFollowUpArbitrationFence()
        if (!arbitration) throw new NativeFollowUpPermitError('follow-up arbitration is unavailable')
        return this.call(operation, { ...body, fence, arbitration })
      }, { baseUrl: this.manager.discovery.baseUrl, token: this.manager.discovery.managerToken,
        flavor: fence.ownerFlavor, instanceId: fence.ownerInstanceId })
    } finally { invalidateTickReads() }
  }

  /** A manual action is minted only by Manager; a generic room commit is not authority. */
  async stageManualFollowUp(participantAgentId: string, commitmentId: string, raw: unknown): Promise<ContinueCommitmentResult> {
    await this.options.ready?.()
    const command = ContinueCommitment.parse(raw)
    const result = ContinueCommitmentResult.parse(await this.followUpMutation('stageManualFollowUp',
      { participantAgentId, commitmentId, command }))
    notifyRoomStoreCommit()
    return result
  }

  async claimManualFollowUp(attemptId: string): Promise<ManualFollowUpClaim> {
    return ManualFollowUpClaim.parse(await this.followUpMutation('claimManualFollowUp', { attemptId }))
  }

  async issueManualFollowUpPermit(attemptId: string, claimToken: number): Promise<CommitmentExecutionPermit> {
    return CommitmentExecutionPermitSchema.parse(await this.followUpMutation('issueManualFollowUpPermit', { attemptId, claimToken }))
  }

  async beginManualFollowUpDispatch(attemptId: string, claimToken: number): Promise<ManualFollowUpDispatch> {
    return ManualFollowUpDispatch.parse(await this.followUpMutation('beginManualFollowUpDispatch', { attemptId, claimToken }))
  }

  async reconcileManualFollowUp(attemptId: string): Promise<FollowUpReceipt> {
    const receipt = FollowUpReceiptSchema.parse(await this.followUpMutation('reconcileManualFollowUp', { attemptId }))
    notifyRoomStoreCommit()
    return receipt
  }

  /** Runs only inside the caller's existing thread mutation lock. */
  async withNativeFollowUpAdmission<T>(input: { thread: ThreadRecord; admission: NativeFollowUpAdmission;
    stage: 'enqueue' | 'promote' }, operation: () => Promise<T>): Promise<T> {
    const fence = this.options.getFence?.()
    if (!fence) throw new NativeFollowUpPermitError('rooms coordinator fence is required for native admission')
    return withFollowUpArbitration(async () => {
      const arbitration = currentFollowUpArbitrationFence()
      if (!arbitration) throw new NativeFollowUpPermitError('native admission arbitration is unavailable')
      // Do not use tick-cached reads for a mutable claim or permit.
      const [effectRow, executionRow] = await Promise.all([
        this.call('get', { kind: 'commitment_effect', id: input.admission.effectId }),
        this.call('get', { kind: 'commitment_execution', id: input.admission.attemptId })
      ])
      if (!effectRow || !executionRow) throw new NativeFollowUpPermitError('native admission records are unavailable')
      const effect = CommitmentEffectSchema.parse(RoomStoredDocumentSchema.parse(effectRow).value)
      const execution = CommitmentExecutionSchema.parse(RoomStoredDocumentSchema.parse(executionRow).value)
      const permit = execution.permit
      if (!permit?.native || execution.nativeRequest?.threadId !== input.thread.id ||
        effect.id !== input.admission.effectId || effect.envelope.attemptId !== input.admission.attemptId ||
        effect.requestId !== input.admission.requestId || effect.admissionKey !== input.admission.admissionKey ||
        effect.fingerprint !== input.admission.fingerprint ||
        input.stage === 'enqueue' && (!effect.claim || effect.claim.ownerId !== fence.ownerInstanceId)) {
        throw new NativeFollowUpPermitError('native admission scope no longer matches its reservation')
      }
      return withNativeFollowUpWriteScope({ admission: input.admission, stage: input.stage,
        claimToken: effect.claim?.token ?? permit.claimToken, arbitration, coordinatorFence: fence }, operation)
    }, { baseUrl: this.manager.discovery.baseUrl, token: this.manager.discovery.managerToken,
      flavor: fence.ownerFlavor, instanceId: fence.ownerInstanceId })
  }

  async listRooms(options: RoomListOptions = {}): Promise<RoomListPage> {
    return z.object({ rooms: z.array(RoomStoredDocumentSchema.extend({
      latestMessageSeq: z.number().int().nonnegative(), latestMessage: RoomLatestMessageSchema.optional()
    })),
      nextCursor: z.string().optional() }).strict().parse(await this.call('listRooms', { options })) as RoomListPage
  }

  async replyPage(input: RoomReplyPageInput): Promise<RoomReplyPage> { return await this.call('replyPage', input) as RoomReplyPage }
  async sidebarPage(input: RoomSidebarQuery): Promise<RoomSidebarPage> { return await this.call('sidebarPage', input) as RoomSidebarPage }
  async searchRooms(input: RoomSearchQuery): Promise<RoomSearchPage> { return await this.call('searchRooms', input) as RoomSearchPage }
  async roomRepositories(): Promise<RoomRepositoryChoice[]> { return await this.call('roomRepositories', {}) as RoomRepositoryChoice[] }
  async runSummary(input: RoomRunSummaryQuery): Promise<RoomRunSummary> { return await this.call('runSummary', input) as RoomRunSummary }

  async getRequest(requestId: string): Promise<RoomStoreRequest | null> {
    return tickCachedRead(`request\0${requestId}`, async () =>
      RoomStoreRequestSchema.nullable().parse(await this.call('getRequest', { requestId })))
  }

  async events(roomId: string, sinceSeq = 0, limit = 200): Promise<RoomStoreEvent[]> {
    return z.array(RoomStoreEventSchema).parse(await this.call('events', { roomId, sinceSeq, limit }))
  }

  async assertOwnership(): Promise<void> {
    const fence = this.fence()
    if (!fence) throw new RoomStoreConflictError('room coordinator ownership is required')
    await this.call('assertOwnership', { fence })
  }
  async latestEventSeq(): Promise<number> { return z.number().parse(await this.call('latestEventSeq', {})) }
  async eventScope(): Promise<string> { return z.string().parse(await this.call('eventScope', {})) }
  async requestOutcomes(input: RoomOutcomeQuery) {
    return z.object({ initializing: z.boolean(), outcomes: z.array(z.object({
      requestId: z.string(), status: z.string(), total: z.number(), revision: z.string()
    }).passthrough()) }).strict().parse(await this.call('requestOutcomes', input)) as {
      initializing: boolean; outcomes: RoomRequestOutcome[] }
  }

  async scrubMemoryData(input: RoomMemoryErasure): Promise<{ scrubbed: number }> {
    invalidateTickReads()
    try {
      await this.options.ready?.()
      const fence = this.fence()
      if (!fence) throw new RoomStoreConflictError('room coordinator ownership is required')
      return z.object({ scrubbed: z.number().int().nonnegative() }).parse(await this.call('scrubMemoryData', { input, fence }))
    } finally {
      invalidateTickReads()
    }
  }

  async close(): Promise<void> {}

  private fence(): ManagerResourceFence | undefined {
    const fence = this.options.getFence?.()
    if (this.options.getFence && !fence) throw new RoomStoreConflictError('room coordinator lease is not held')
    return fence
  }

  private async call(operation: string, value: unknown): Promise<unknown> {
    try {
      const response = await requestManagerJson(this.manager, `/v1/data/room/${operation}`, {
        method: 'POST',
        body: value,
        // Commits have a mandatory durable request ID, so ambiguous responses are safe to replay.
        retrySafe: true,
        timeoutMs: 30_000
      })
      return z.object({ result: z.unknown() }).strict().parse(response).result
    } catch (error) {
      if (error instanceof ServiceManagerHttpError && error.status === 409) {
        let detail: unknown
        try { detail = JSON.parse(error.detail) } catch { detail = null }
        const parsed = z.object({ message: z.string(), currentRevision: z.number().nullable().optional() }).safeParse(detail)
        throw new RoomStoreConflictError(parsed.success ? parsed.data.message : error.message,
          parsed.success ? parsed.data.currentRevision ?? null : null)
      }
      throw error
    }
  }
}
