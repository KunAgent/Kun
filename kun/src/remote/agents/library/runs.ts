import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { RoomMessage } from '../../../contracts/rooms.js'
import type { RoomRunRecord } from '../../../contracts/room-runs.js'
import { isHiddenAgentSetupMessage } from '../../../agents/agent-setup.js'
import { requireAgent } from '../access.js'
import { readableAgentRoom, libraryCursor, libraryPage } from './access.js'
import { memoryContentSlice } from '../memory/content-window.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { requireCode } from '../../code/access.js'
export class RemoteAgentRuns {
  constructor(private readonly runtime: ServerRuntime) {}
  async checked(agentId: string, runId: string, expectedRevision?: number) {
    const rooms = this.runtime.rooms!
    const row = await rooms.deps.store.get<RoomRunRecord>('room_run', runId)
    if (!row || row.value.id !== runId || row.value.participantAgentId !== agentId || row.value.phase !== 'conversation' || row.roomId !== row.value.roomId)
      throw new RemoteNoEffect('NOT_FOUND')
    const room = await readableAgentRoom(this.runtime, agentId, row.roomId!)
    if (!room.members.some((member) => member.id === row.value.memberId && member.participantAgentId === agentId))
      throw new RemoteNoEffect('NOT_FOUND')
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    const trigger = row.value.triggerMessageId ? await rooms.deps.store.get<RoomMessage>('message', row.value.triggerMessageId) : null
    if (trigger && trigger.roomId === room.id && isHiddenAgentSetupMessage(trigger.value)) throw new RemoteNoEffect('NOT_FOUND')
    return row
  }
  async messages(agentId: string, run: RoomRunRecord) {
    const messages = []
    for (const id of new Set([run.triggerMessageId, run.publishedMessageId].filter((id): id is string => Boolean(id)))) {
      const row = await this.runtime.rooms!.deps.store.get<RoomMessage>('message', id), message = row?.value
      if (!message || row?.roomId !== run.roomId || message.roomId !== run.roomId || message.id !== id ||
        isHiddenAgentSetupMessage(message) || message.status !== 'final') continue
      const trigger = id === run.triggerMessageId
      if (message.authorKind === 'system' || message.authorKind === 'member' &&
        (message.authorMemberId !== run.memberId || message.authorAgentId && message.authorAgentId !== agentId)) continue
      if (!trigger && (message.originRunId !== run.id || message.authorKind !== 'member')) continue
      messages.push(message)
    }
    return messages
  }
  async project(agentId: string, row: Awaited<ReturnType<RemoteAgentRuns['checked']>>) {
    const run = row.value, messages = await this.messages(agentId, run), summary = messages[0]?.body ?? ''
    let code: { resource: { kind: 'code'; id: string }; turnId?: string; historyVersion: string } | undefined
    if (run.threadId) {
      const thread = await requireCode(this.runtime, run.threadId).catch(() => null)
      if (thread && (!run.turnId || thread.turns.some((turn) => turn.id === run.turnId))) code = {
        resource: { kind: 'code', id: thread.id }, ...(run.turnId ? { turnId: run.turnId } : {}),
        historyVersion: await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy' }
    }
    return { id: row.id, revision: row.revision, status: run.status, ...(run.outcome ? { outcome: run.outcome } : {}),
      attempt: run.attempt, createdAt: run.createdAt, updatedAt: run.updatedAt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      ...(run.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
      ...(run.status === 'failed' ? { errorCode: 'RUN_FAILED' as const } : {}),
      summary: { text: memoryContentSlice(summary, 0, 240).text, truncated: summary.length > 240 },
      source: { resource: { kind: 'agent' as const, id: agentId }, roomId: run.roomId, runId: run.id, runRevision: row.revision,
        ...(messages.find((message) => message.id === run.publishedMessageId) ? { messageId: run.publishedMessageId } : {}),
        ...(code ? { code } : {}) } }
  }
  async list(p: any) {
    await requireAgent(this.runtime.rooms!, p.agentId)
    const page = libraryCursor('agent.runs.list', [p.agentId, p.status ?? null], p.cursor)
    const runs = [], deadline = Date.now() + 1000
    let before = page.before, incomplete = Boolean(page.incomplete), hasMore = false
    for (let scanned = 0; scanned < 100 && runs.length < p.limit && Date.now() < deadline; scanned++) {
      const rows = await this.runtime.rooms!.deps.store.list<RoomRunRecord>('room_run', {
        participantAgentId: p.agentId, phase: 'conversation', status: p.status, limit: 1, beforeSeq: before, summaryOnly: true })
      if (!rows.length) { hasMore = false; break }
      before = rows[0].seq; hasMore = true
      try { const row = await this.checked(p.agentId, rows[0].id); runs.push(await this.project(p.agentId, row)) }
      catch (error) { if (!(error instanceof RemoteNoEffect)) throw error }
    }
    if (hasMore) hasMore = Boolean((await this.runtime.rooms!.deps.store.list('room_run', {
      participantAgentId: p.agentId, phase: 'conversation', status: p.status, limit: 1, beforeSeq: before })).length)
    return { agentId: p.agentId, runs, ...libraryPage(page.scope, before, hasMore, incomplete) }
  }
  async get(p: any) {
    const row = await this.checked(p.agentId, p.runId, p.expectedRevision), messages = await this.messages(p.agentId, row.value)
    const result = { run: await this.project(p.agentId, row), messages: messages.map((message) => {
      const slice = memoryContentSlice(message.body, 0, 320)
      return { id: message.id, role: message.authorKind === 'user' ? 'user' as const : 'assistant' as const,
        bodyRevision: message.bodyRevision, createdAt: message.createdAt, snippet: slice.text, contentLength: slice.totalChars,
        contentTruncated: slice.nextOffset !== undefined }
    }) }
    if (!p.messageId) return result
    const message = messages.find((item) => item.id === p.messageId)
    if (!message) throw new RemoteNoEffect('NOT_FOUND')
    if (message.bodyRevision !== p.expectedMessageRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    const content = memoryContentSlice(message.body, p.contentOffset, p.maxChars)
    // Read-side fences cover a simultaneous delete, room change or text edit.
    const fresh = await this.checked(p.agentId, p.runId, p.expectedRevision)
    const current = (await this.messages(p.agentId, fresh.value)).find((item) => item.id === message.id)
    if (!current) throw new RemoteNoEffect('NOT_FOUND')
    if (current.bodyRevision !== message.bodyRevision || current.body !== message.body) throw new RemoteNoEffect('REVISION_CONFLICT')
    return { ...result, message: { id: message.id, bodyRevision: message.bodyRevision, content } }
  }
}
