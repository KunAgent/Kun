import { formatMemoryReferenceBlock } from '../memory/memory-context-format.js'
import { editAgentMemory, recoverAgentMemoryEdits } from './agent-memory-edit.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MemoryCreateRequest, MemoryUpdateRequest, type MemoryRecord } from '../contracts/memory.js'
import type { MemoryStore, MemoryListFilter } from '../memory/memory-store.js'
import type { AgentMemoryAccess } from '../memory/agent-memory-scope.js'
import { containsCredentialLikeData, containsTransientRequest } from '../memory/memory-distillation.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { agentStableId } from './agent-identity-service.js'

const Id = z.string().min(1).max(128)
export const AgentMemoryWrite = z.object({
  clientRequestId: Id, conversationId: Id, sourceMessageIds: z.array(Id).min(1).max(8),
  content: z.string().trim().min(1).max(4000), type: z.enum(['fact', 'preference', 'decision', 'episode', 'relationship', 'insight']).default('fact'),
  shared: z.boolean().default(false)
}).strict()
export const AgentMemoryEdit = z.object({
  clientRequestId: Id, expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().trim().min(1).max(4000).optional(),
  disabled: z.boolean().optional(), forget: z.boolean().optional(),
  locked: z.boolean().optional(), shared: z.boolean().optional(),
  sharedConversationIds: z.array(Id).max(100).optional(),
  sharedProjectRoots: z.array(z.string().min(1).max(4096)).max(100).optional()
}).strict()
export const AgentMemoryPage = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(2048).optional(),
  includeDeleted: z.boolean().default(false)
}).strict()
const Cursor = z.object({ agentId: Id, updatedAt: z.string(), id: z.string().max(256) }).strict()

export class AgentMemoryService {
  constructor(readonly agents: AgentIdentityService, private readonly storage: () => MemoryStore | undefined,
    private readonly enabled: () => boolean = () => true) {}
  store(): MemoryStore {
    const store = this.storage()
    if (!store) throw new Error('agent memory storage is unavailable')
    return store
  }
  async available(): Promise<boolean> { return Boolean(this.storage()) && this.enabled() && (await this.agents.features()).memory }
  async list(agentId: string, raw: unknown) {
    await this.agents.get(agentId)
    const input = AgentMemoryPage.parse(raw)
    let before: MemoryListFilter['before']
    if (input.cursor) {
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) } catch { parsed = null }
      const cursor = Cursor.parse(parsed)
      if (cursor.agentId !== agentId) throw new RoomStoreConflictError('memory cursor belongs to another agent')
      before = cursor
    }
    const records = await this.store().list({ agent: { agentId, manage: true }, includeDeleted: input.includeDeleted,
      limit: input.limit + 1, before })
    const selected = records.slice(0, input.limit)
    const last = selected.at(-1)
    return { memories: selected.map((memory) => ({ memory, fingerprint: canonicalMemoryHash(memory) })),
      ...(records.length > input.limit && last ? { nextCursor: Buffer.from(JSON.stringify({
        agentId, id: last.id, updatedAt: last.updatedAt })).toString('base64url') } : {}),
      available: await this.available() }
  }
  async find(agentId: string, id: string): Promise<MemoryRecord> {
    const store = this.store()
    if (!store.getById) throw new Error('scoped memory lookup unavailable')
    return store.getById(id, { agent: { agentId, manage: true } })
  }

  async evidence(agentId: string, conversationId: string, sourceIds: string[]) {
    const room = await this.agents.store.get<Room>('room', conversationId)
    if (!room || !room.value.members.some((member) => member.participantAgentId === agentId && !member.removedAt)) {
      throw new Error('agent memory source conversation not found')
    }
    const sources = []
    for (const id of sourceIds) {
      const row = await this.agents.store.get<RoomMessage>('message', id)
      if (!row || row.roomId !== conversationId || row.value.status !== 'final') throw new Error('agent memory source message not found')
      sources.push({ id, kind: row.value.authorKind === 'user' ? 'user' as const : 'inference' as const,
        locator: 'room:' + conversationId + '/message:' + id,
        excerpt: row.value.body.slice(0, 512),
        contentHash: createHash('sha256').update(row.value.body).digest('hex'),
        trust: row.value.authorKind === 'user' ? 'explicit-user' as const : 'inferred' as const })
    }
    return sources
  }
  async create(agentId: string, raw: unknown) {
    const input = AgentMemoryWrite.parse(raw)
    await this.agents.active(agentId)
    if (!await this.available()) throw new RoomStoreConflictError('agent memory is disabled')
    const sources = await this.evidence(agentId, input.conversationId, input.sourceMessageIds)
    const conversation = (await this.agents.store.get<Room>('room', input.conversationId))!.value
    let sourceHandoffId: string | undefined
    if (conversation.conversationKind === 'agent_agent') {
      const messages = await Promise.all(input.sourceMessageIds.map((id) => this.agents.store.get<RoomMessage>('message', id)))
      const scopes = new Set(messages.map((row) => row?.value.handoffId))
      if (scopes.size !== 1 || !messages[0]?.value.handoffId) throw new RoomStoreConflictError('memory cannot mix different handoff scopes')
      sourceHandoffId = messages[0].value.handoffId
    }
    if (containsCredentialLikeData({ content: input.content, type: input.type, confidence: 1, importance: .5, observedAt: new Date().toISOString(), tags: [], sources })) {
      throw new RoomStoreConflictError('credential-like content cannot be saved as memory')
    }
    if (input.shared && input.type !== 'preference') throw new RoomStoreConflictError('only an explicit preference can be marked universal')
    const id = agentStableId('mem-agent', agentId, input.clientRequestId)
    const store = this.store()
    if (!store.createWithId) throw new Error('idempotent agent memory persistence is unavailable')
    const memory = await store.createWithId(id, MemoryCreateRequest.parse({
      content: input.content, type: input.type, scope: 'user', sources,
      agentContext: { schemaVersion: 1, agentId, sourceConversationId: input.conversationId,
        sourceHandoffId, shared: input.shared, locked: true, originFingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex') }, provenance: { kind: 'user', origin: 'agent-memory' }
    }))
    return { memory, fingerprint: canonicalMemoryHash(memory) }
  }
  async edit(agentId: string, id: string, raw: unknown) {
    return editAgentMemory(this, agentId, id, raw)
  }
  async recoverEdits() { return recoverAgentMemoryEdits(this) }

  async context(agentId: string, conversationId: string, query: string, project?: string, handoffId?: string, byteBudget = 4000, taskId?: string) {
    const agent = await this.agents.get(agentId)
    if (!agent.memory.readEnabled || !await this.available()) return { records: [], text: '' }
    const access: AgentMemoryAccess = { agentId, conversationId, handoffId, taskId }
    const records = await this.store().retrieve({ agent: access, project, query: query.slice(0, 4096),
      limit: 8, promptCharacterBudget: 4000 })
    while (records.length && Buffer.byteLength(formatMemoryReferenceBlock(records, Date.now())) > byteBudget) records.pop()
    return { records, text: formatMemoryReferenceBlock(records, Date.now()) }
  }
}
