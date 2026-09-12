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

/** Runtime proxy. Canonical room data never opens a local file in this process. */
export class RemoteRoomStore implements RoomStore {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly options: { getFence?: () => ManagerResourceFence | undefined } = {}
  ) {}

  async get<T = unknown>(kind: RoomDocumentKind, id: string): Promise<RoomStoredDocument<T> | null> {
    return RoomStoredDocumentSchema.nullable().parse(await this.call('get', { kind, id })) as RoomStoredDocument<T> | null
  }

  async list<T = unknown>(kind: RoomDocumentKind, options: RoomStoreListOptions = {}): Promise<RoomStoredDocument<T>[]> {
    return z.array(RoomStoredDocumentSchema).parse(await this.call('list', { kind, options })) as RoomStoredDocument<T>[]
  }

  async commit(input: RoomStoreCommit): Promise<RoomStoreCommitResult> {
    const fence = this.fence()
    return RoomStoreCommitResultSchema.parse(await this.call('commit', { input, ...(fence ? { fence } : {}) }))
  }

  async listRooms(options: RoomListOptions = {}): Promise<RoomListPage> {
    return z.object({ rooms: z.array(RoomStoredDocumentSchema.extend({ latestMessageSeq: z.number().int().nonnegative() })),
      nextCursor: z.string().optional() }).strict().parse(await this.call('listRooms', { options })) as RoomListPage
  }

  async getRequest(requestId: string): Promise<RoomStoreRequest | null> {
    return RoomStoreRequestSchema.nullable().parse(await this.call('getRequest', { requestId }))
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
