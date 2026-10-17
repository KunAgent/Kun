import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RoomMessage } from '../../contracts/rooms.js'
import type { TurnItem } from '../../contracts/items.js'
import { isHiddenAgentSetupMessage } from '../../agents/agent-setup.js'
import { agentAttachmentSources } from '../agents/attachment-sources.js'
import { remoteResource, verifyResourceVersion } from '../resources/access.js'
import type {RemoteResource } from '../resources/contracts.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { RemoteSourceSearch, checkSourcePosition } from './source/search.js'
import type { SourceReadScope } from './source/content.js'
import { messageSnippet as snippet, type MessageSearchResult, type RemoteMessageMatch, type SourceSearchPosition } from './search-types.js'

type Search = { resource: RemoteResource; query: string; cursor?: string; limit?: number }
type Position = { before?: string; itemId?: string; turnId?: string; offset?: number; more?: boolean }
const searchable = new Set(['user_message', 'assistant_text', 'assistant_reasoning', 'tool_call', 'tool_result', 'error', 'approval', 'user_input'])
export class RemoteMessages {
  constructor(private runtime: ServerRuntime) {}
  async search(p: Search, access?: SourceReadScope): Promise<MessageSearchResult> {
    await access?.authorize()
    const target = await remoteResource(this.runtime, p.resource)
    if (p.resource.kind === 'code') {
      const result = await this.codeSearch(p, target.version, target.thread!.historyRefId, access)
      await verifyResourceVersion(this.runtime, p.resource, target.version)
      await access?.authorize()
      return result
    }
    const scope = cursorScope(['message.search', p.resource, p.query, target.version])
    const position = readCursor<Position>(p.cursor, scope, {})
    if ((position.before !== undefined && typeof position.before !== 'string') ||
      (position.offset !== undefined && (!Number.isSafeInteger(position.offset) || position.offset < 0)) ||
      (position.itemId !== undefined && (typeof position.itemId !== 'string' || typeof position.turnId !== 'string')))
      throw new Error('INVALID_CURSOR')
    const result = await this.agentSearch(p, target, scope, position)
    await verifyResourceVersion(this.runtime, p.resource, target.version)
    await access?.authorize()
    return { ...result, complete: !result.hasMore, coverage: { native: result.hasMore ? 'scanning' : 'complete', source: 'not_applicable' } }
  }
  private async agentSearch(p: Search, target: Awaited<ReturnType<typeof remoteResource>>, scope: string, position: Position) {
    if (!target.room) return { messages: [], hasMore: false }
    if (position.before !== undefined && !/^[0-9]+$/.test(position.before)) throw new Error('INVALID_CURSOR')
    const rows = await this.runtime.rooms!.deps.store.list<RoomMessage>('message', {
      roomId: target.room.id, search: p.query, beforeSeq: position.before ? Number(position.before) : undefined,
      limit: (p.limit ?? 20) + 1
    })
    const selected = rows.slice(0, p.limit ?? 20), hasMore = rows.length > selected.length
    return { messages: selected.filter((row) => !isHiddenAgentSetupMessage(row.value)).map((row) => ({
      resource: p.resource, messageId: row.id, historyVersion: target.version, kind: 'room_message',
      role: row.value.authorKind === 'user' ? 'user' : 'assistant', snippet: snippet(row.value.body, p.query),
      createdAt: row.value.createdAt
    })), hasMore, ...(hasMore && selected.length ? { nextCursor: writeCursor(scope, { before: String(selected.at(-1)!.seq) }) } : {}) }
  }
  private async codeSearch(p: Search, version: string, referenceId?: string, access?: SourceReadScope): Promise<MessageSearchResult> {
    type SearchPosition = { phase?: 'native' | 'source'; binding?: string; fingerprint?: string; native?: Position; source?: SourceSearchPosition }
    const source = new RemoteSourceSearch(this.runtime), context = await source.describe(p.resource.id, version, access)
    if (context.referenceId !== referenceId) throw new Error('HISTORY_CHANGED')
    const scope = cursorScope(['message.search.v2', p.resource, p.query, access?.scope ?? 'personal'])
    const binding = cursorScope([version, referenceId ?? null])
    let position: SearchPosition
    try { position = readCursor<SearchPosition>(p.cursor, scope, {}) }
    catch (error) {
      if (referenceId || access) throw error
      // Retain opaque native-only cursors issued by 0.7 while no source branch is attached.
      const old = readCursor<Position>(p.cursor, cursorScope(['message.search', p.resource, p.query, version]), {})
      position = { phase: 'native', native: old, binding }
    }
    if (Object.keys(position).some((key) => !['phase', 'binding', 'fingerprint', 'native', 'source'].includes(key)) ||
      position.phase !== undefined && !['native', 'source'].includes(position.phase) || p.cursor && !position.binding ||
      position.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(position.fingerprint)) throw new Error('INVALID_CURSOR')
    if (position.binding && position.binding !== binding || position.fingerprint && context.fingerprint && position.fingerprint !== context.fingerprint) throw new Error('HISTORY_CHANGED')
    const native = position.native ?? {}, sourcePosition = position.source ?? {}
    if (!native || typeof native !== 'object' || Array.isArray(native) || Object.keys(native).some((key) => !['before', 'itemId', 'turnId', 'offset', 'more'].includes(key)) ||
      native.before !== undefined && (typeof native.before !== 'string' || native.before.length > 128) ||
      native.itemId !== undefined && (typeof native.itemId !== 'string' || native.itemId.length > 128) ||
      native.turnId !== undefined && (typeof native.turnId !== 'string' || native.turnId.length > 128) ||
      native.offset !== undefined && (!Number.isSafeInteger(native.offset) || native.offset < 0)) throw new Error('INVALID_CURSOR')
    checkSourcePosition(sourcePosition)
    const messages: RemoteMessageMatch[] = [], limit = p.limit ?? 20
    let phase = position.phase ?? 'native', nextNative = native, nextSource = sourcePosition, nativeMore = phase === 'native'
    if (phase === 'native') {
      const result = await this.nativeSearch(p, version, native)
      messages.push(...result.messages); nextNative = result.position; nativeMore = result.hasMore
      if (!nativeMore) phase = 'source'
    }
    let sourceStatus = context.status, sourceMore = context.status === 'pending'
    if (!nativeMore && messages.length < limit) {
      const result = await source.search(p.resource.id, version, p.query, context, sourcePosition, limit - messages.length, access)
      messages.push(...result.messages); nextSource = result.position; sourceStatus = result.status; sourceMore = result.hasMore
    }
    const hasMore = nativeMore || sourceMore
    const current = await remoteResource(this.runtime, p.resource)
    if (current.thread?.historyRefId !== referenceId) throw new Error('HISTORY_CHANGED')
    return { messages, hasMore, complete: !hasMore && ['not_applicable', 'complete'].includes(sourceStatus),
      coverage: { native: nativeMore ? 'scanning' : 'complete', source: sourceStatus, ...(referenceId ? { referenceId } : {}) },
      ...(hasMore ? { nextCursor: writeCursor(scope, { phase, binding,
        ...(context.fingerprint ?? position.fingerprint ? { fingerprint: context.fingerprint ?? position.fingerprint } : {}),
        ...(nativeMore ? { native: nextNative } : {}), ...(sourceMore ? { source: nextSource } : {}) }) } : {}) }
  }
  private async nativeSearch(p: Search, version: string, position: Position) {
    const load = this.runtime.sessionStore.loadItemPage
    if (!load) throw new Error('UNSUPPORTED_OPERATION')
    const store = this.runtime.sessionStore, messages: RemoteMessageMatch[] = [], deadline = Date.now() + 1000
    let state: Position = { ...position }, hasMore = true, scanned = 0, bytes = 0
    while (messages.length < (p.limit ?? 20) && scanned < 100 && bytes < 128 * 1024 && Date.now() < deadline) {
      const page = await load.call(store, p.resource.id, { before: state.before, maxItems: 1, maxBytes: 4096 })
      const item = page.items.at(-1)
      if (!item) { hasMore = false; break }
      if (item.id === state.before) throw new Error('INVALID_CURSOR')
      if (state.itemId && state.itemId !== item.id) throw new Error('HISTORY_CHANGED')
      const advance = () => { state = { before: item.id }; hasMore = page.hasMore; scanned++ }
      if (!searchable.has(item.kind)) { advance(); if (!hasMore) break; continue }
      const contentPage = await load.call(store, p.resource.id, { turnId: item.turnId, itemId: item.id,
        contentOffset: state.offset ?? 0, maxItems: 1, maxBytes: 32768 })
      const content = contentPage.content
      if (!content) { advance(); if (!hasMore) break; continue }
      bytes += Buffer.byteLength(content.text)
      if (content.text.toLowerCase().includes(p.query.toLowerCase())) {
        messages.push({ resource: p.resource, messageId: item.id, historyVersion: version, turnId: item.turnId,
          kind: item.kind, role: role(item), snippet: snippet(content.text, p.query), createdAt: item.createdAt })
        advance()
      } else if (content.nextOffset !== undefined) {
        const next = Math.max(content.offset + 1, content.nextOffset - Math.max(0, Math.max(p.query.length, p.query.toLowerCase().length) - 1))
        state = { before: state.before, itemId: item.id, turnId: item.turnId, offset: next, more: page.hasMore }
      } else advance()
      if (!hasMore) break
    }
    return { messages, hasMore, position: state }
  }
  async get(p: { resource: RemoteResource; messageId: string; turnId?: string; historyVersion: string; contentOffset?: number; maxChars?: number }) {
    const target = await remoteResource(this.runtime, p.resource)
    if (target.version !== p.historyVersion) throw new Error('HISTORY_CHANGED')
    const offset = p.contentOffset ?? 0, max = p.maxChars ?? 8192
    let result
    if (p.resource.kind === 'agent') {
      const row = await this.runtime.rooms!.deps.store.get<RoomMessage>('message', p.messageId)
      if (!target.room || !row || row.roomId !== target.room.id || row.value.roomId !== target.room.id ||
        isHiddenAgentSetupMessage(row.value)) throw new Error('NOT_FOUND')
      const start = Math.min(offset, row.value.body.length)
      const text = [...row.value.body.slice(start)].slice(0, max).join(''), end = start + text.length
      const [message] = await agentAttachmentSources(this.runtime, target.room.id, [{ ...row.value, body: '' }])
      result = { message, content: { field: 'body', text, offset: start,
        ...(end < row.value.body.length ? { nextOffset: end } : {}), totalChars: row.value.body.length } }
    } else {
      if (!p.turnId || !this.runtime.sessionStore.loadItemPage) throw new Error('INVALID_REQUEST')
      const page = await this.runtime.sessionStore.loadItemPage(p.resource.id, { turnId: p.turnId,
        itemId: p.messageId, contentOffset: offset, maxItems: 1, maxBytes: 128 * 1024 })
      if (!page.content) throw new Error('NOT_FOUND')
      const content = page.content, text = [...content.text].slice(0, max).join(''), end = content.offset + text.length
      result = { content: { ...content, text, ...(end < content.totalChars ? { nextOffset: end } : { nextOffset: undefined }) } }
    }
    await verifyResourceVersion(this.runtime, p.resource, target.version)
    return { resource: p.resource, messageId: p.messageId, historyVersion: target.version,
      ...(p.turnId ? { turnId: p.turnId } : {}), ...result }
  }
}
function role(item: TurnItem) {
  return item.role
}
