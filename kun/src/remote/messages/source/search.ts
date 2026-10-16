import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { HistoryReferenceService } from '../../../history/history-reference-service.js'
import type { HistoryReference } from '../../../contracts/history-reference.js'
import { boundedSourceRead, sourceReferenceFingerprint, type SourceReadScope } from './content.js'
import { SourceContentParams } from './content-contracts.js'
import { requireCode } from '../../code/access.js'
import { cursorScope } from '../../cursor-codec.js'
import { messageSnippet, type RemoteMessageMatch, type SourceSearchCoverage, type SourceSearchPosition } from '../search-types.js'
type SourceContext = { referenceId?: string; fingerprint?: string; status: SourceSearchCoverage; source?: HistoryReferenceService; reference?: HistoryReference }
const searchable = new Set(['user_message', 'assistant_text', 'assistant_reasoning', 'tool_call', 'tool_result', 'error'])
function prefix(text: string, budget: number) {
  let value = '', bytes = 0
  for (const char of text) { const size = Buffer.byteLength(char); if (bytes + size > budget) break; value += char; bytes += size }
  return { text: value, bytes }
}
export function checkSourcePosition(value: SourceSearchPosition) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !['before', 'anchor', 'offset', 'partial'].includes(k)) ||
    value.before !== undefined && (typeof value.before !== 'string' || value.before.length > 512) ||
    value.anchor !== undefined && !/^[a-f0-9]{64}$/.test(value.anchor) ||
    value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0 || !value.anchor) ||
    value.partial !== undefined && typeof value.partial !== 'boolean') throw new Error('INVALID_CURSOR')
}
/** Structured page reads keep exact source IDs in responses; cursors retain only positions and identity digests. */
export class RemoteSourceSearch {
  constructor(private runtime: ServerRuntime) {}
  async describe(threadId: string, version: string, access?: SourceReadScope): Promise<SourceContext> {
    await access?.authorize()
    const thread = await requireCode(this.runtime, threadId)
    if ((await this.runtime.sessionStore.itemHistoryVersion?.(threadId) ?? 'legacy') !== version) throw new Error('HISTORY_CHANGED')
    if (!thread.historyRefId) return { status: 'not_applicable' }
    const referenceId = thread.historyRefId, source = this.runtime.historyReferences
    if (!source) return { referenceId, status: 'disabled' }
    try {
      return await boundedSourceRead(this.runtime, async () => {
        const reference = await source.get(referenceId)
        if (!reference) return { referenceId, status: 'missing' as const }
        return { referenceId, source, reference, fingerprint: sourceReferenceFingerprint(reference),
          status: source.isEnabled(reference.provider) ? 'pending' as const : 'disabled' as const }
      })
    } catch { return { referenceId, status: 'unavailable' } }
  }
  async search(threadId: string, version: string, query: string, context: SourceContext, position: SourceSearchPosition, limit: number, access?: SourceReadScope) {
    checkSourcePosition(position)
    if (context.status !== 'pending') return { messages: [] as RemoteMessageMatch[], hasMore: false, position, status: context.status }
    try { return await boundedSourceRead(this.runtime, (current) => this.scan(threadId, version, query, context, position, limit, current, access)) }
    catch (error) {
      if (error instanceof Error && ['HISTORY_CHANGED', 'INVALID_CURSOR', 'SHARE_AUTHORIZATION_STALE', 'SHARE_NOT_ALLOWED'].includes(error.message)) throw error
      return { messages: [] as RemoteMessageMatch[], hasMore: false, position,
        status: error instanceof Error && error.message === 'SOURCE_HISTORY_DISABLED' ? 'disabled' as const : 'unavailable' as const }
    }
  }
  private async scan(threadId: string, version: string, query: string, context: SourceContext, initial: SourceSearchPosition,
    limit: number, current: () => boolean, access?: SourceReadScope) {
    const source = context.source!, referenceId = context.referenceId!, fingerprint = context.fingerprint!
    const state = { ...initial }, messages: RemoteMessageMatch[] = [], deadline = Date.now() + 1000, needle = query.toLowerCase()
    let scanned = 0, bytes = 0, hasMore = true
    const verify = async () => {
      if (!current()) throw new Error('SOURCE_HISTORY_UNAVAILABLE')
      await access?.authorize()
      const thread = await requireCode(this.runtime, threadId), reference = await source.get(referenceId)
      if (thread.historyRefId !== referenceId || (await this.runtime.sessionStore.itemHistoryVersion?.(threadId) ?? 'legacy') !== version ||
        !reference || sourceReferenceFingerprint(reference) !== fingerprint) throw new Error('HISTORY_CHANGED')
      if (!source.isEnabled(reference.provider)) throw new Error('SOURCE_HISTORY_DISABLED')
    }
    const status = (value: string): SourceSearchCoverage | null => {
      if (value === 'partial') { state.partial = true; return null }
      return value === 'available' ? null : value === 'changed' || value === 'missing' ? value : 'unavailable'
    }
    await verify()
    while (messages.length < limit && scanned < 100 && bytes < 128 * 1024 && (scanned === 0 || Date.now() < deadline)) {
      // Keep enough overlap for a full query; a tiny last slice must never skip a cross-page match.
      if (scanned && 128 * 1024 - bytes < (Math.max(query.length, needle.length) + 2) * 4) break
      const page = await source.page(referenceId, { threadId, cursor: state.before, limit: 1 })
      await verify()
      const unavailable = status(page.status)
      if (unavailable) return { messages, hasMore: false, position: state, status: unavailable }
      const item = page.turns.flatMap((turn) => turn.items).at(-1)
      if (!item) {
        if (!page.hasMore) { hasMore = false; break }
        if (!page.nextCursor || page.nextCursor === state.before) throw new Error('INVALID_CURSOR')
        state.before = page.nextCursor; scanned++; continue
      }
      const anchor = cursorScope([item.turnId, item.id, item.sourceHistoryOrder])
      if (state.anchor && state.anchor !== anchor) throw new Error('HISTORY_CHANGED')
      const advance = () => {
        if (page.hasMore && (!page.nextCursor || page.nextCursor === state.before)) throw new Error('INVALID_CURSOR')
        state.before = page.nextCursor; delete state.anchor; delete state.offset; hasMore = page.hasMore; scanned++
      }
      if (!searchable.has(item.kind)) { advance(); if (!hasMore) break; continue }
      const valid = SourceContentParams.safeParse({ resource: { kind: 'code', id: threadId }, referenceId, historyVersion: version, turnId: item.turnId, messageId: item.id })
      if (!valid.success || item.sourceHistoryOrder?.referenceId !== referenceId) { state.partial = true; advance(); if (!hasMore) break; continue }
      const contentPage = await source.page(referenceId, { threadId, turnId: item.turnId, itemId: item.id, contentOffset: state.offset ?? 0, limit: 1 })
      await verify()
      const unreadable = status(contentPage.status)
      if (unreadable) return { messages, hasMore: false, position: state, status: unreadable }
      const content = contentPage.content
      if (!content || content.itemId !== item.id || content.offset !== (state.offset ?? 0) || content.text.length > 16384) {
        state.partial = true; advance(); if (!hasMore) break; continue
      }
      const chunk = prefix(content.text, 128 * 1024 - bytes), end = content.offset + chunk.text.length
      bytes += chunk.bytes; scanned++
      if (chunk.text.toLowerCase().includes(needle)) {
        messages.push({ resource: { kind: 'code', id: threadId }, messageId: item.id, turnId: item.turnId, historyVersion: version,
          kind: item.kind, role: item.role, snippet: messageSnippet(chunk.text, query), createdAt: item.createdAt, sourceHistoryOrder: item.sourceHistoryOrder })
        advance()
      } else if (end < content.totalChars) {
        const overlap = Math.max(query.length, needle.length) - 1
        state.anchor = anchor; state.offset = Math.max(content.offset + 1, end - overlap)
      } else advance()
      if (!hasMore) break
    }
    await verify()
    return { messages, hasMore, position: state, status: state.partial ? 'partial' as const : hasMore ? 'scanning' as const : 'complete' as const }
  }
}
