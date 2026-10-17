import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { HistoryReference } from '../../../contracts/history-reference.js'
import { requireCode } from '../../code/access.js'
import { cursorScope, readCursor, writeCursor } from '../../cursor-codec.js'
import { SourceContentParams, type SourceContentParams as Params } from './content-contracts.js'

export type SourceReadScope = { scope: unknown; authorize(): Promise<unknown> }
type Position = { offset: number; fingerprint: string }
/** Hash immutable branch identity only. Relinking identical bytes does not change authorization or leak a source path. */
export const sourceReferenceFingerprint = (ref: HistoryReference) => cursorScope({ id: ref.id, provider: ref.provider, sessionId: ref.sessionId,
  cutoff: ref.cutoffTurnId, parser: ref.parserVersion, source: ref.provider === 'opencode'
    ? { kind: ref.source.kind, records: ref.records } : ref.files.map(({ sessionId, sha256, byteLength, recordCount }) => ({ sessionId, sha256, byteLength, recordCount })) })
const reads = new WeakMap<ServerRuntime, { active: number }>()
export async function boundedSourceRead<T>(runtime: ServerRuntime, read: (current: () => boolean) => Promise<T>): Promise<T> {
  let state = reads.get(runtime)
  if (!state) { state = { active: 0 }; reads.set(runtime, state) }
  if (state.active >= 2) throw new Error('SOURCE_HISTORY_BUSY')
  state.active++
  let timer: ReturnType<typeof setTimeout> | undefined, active = true
  // A deadline does not cancel the underlying history parser. Keep its slot until it actually settles.
  const operation = Promise.resolve().then(() => read(() => active)).finally(() => { state.active-- })
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { active = false; reject(new Error('SOURCE_HISTORY_UNAVAILABLE')) }, 5000)
  })]) } finally { active = false; clearTimeout(timer) }
}
/** Exact-record reads from the existing frozen history boundary. Nothing is copied into native session persistence. */
export class RemoteSourceContent {
  constructor(private runtime: ServerRuntime) {}
  get available() { return Boolean(this.runtime.historyReferences?.isEnabled()) }
  private async snapshot(p: Params, access?: SourceReadScope) {
    await access?.authorize()
    const thread = await requireCode(this.runtime, p.resource.id), source = this.runtime.historyReferences
    if (thread.historyRefId !== p.referenceId || (await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy') !== p.historyVersion)
      throw new Error('HISTORY_CHANGED')
    if (!source) throw new Error('SOURCE_HISTORY_DISABLED')
    const ref = await source.get(p.referenceId)
    if (!ref) throw new Error('SOURCE_HISTORY_MISSING')
    if (!source.isEnabled(ref.provider)) throw new Error('SOURCE_HISTORY_DISABLED')
    if (!p.turnId.startsWith(ref.provider + ':' + ref.sessionId + ':')) throw new Error('NOT_FOUND')
    return { source, ref, fingerprint: sourceReferenceFingerprint(ref) }
  }
  async get(raw: Params, access?: SourceReadScope) {
    const p = SourceContentParams.parse(raw)
    try { return await boundedSourceRead(this.runtime, () => this.read(p, access)) }
    catch (error) {
      if (error instanceof Error && ['HISTORY_CHANGED', 'NOT_FOUND', 'NOT_A_CODE_TASK', 'INVALID_CURSOR',
        'SOURCE_HISTORY_DISABLED', 'SOURCE_HISTORY_MISSING', 'SOURCE_HISTORY_UNAVAILABLE', 'SOURCE_HISTORY_BUSY',
        'SHARE_AUTHORIZATION_STALE', 'SHARE_NOT_ALLOWED'].includes(error.message)) throw error
      throw new Error('SOURCE_HISTORY_UNAVAILABLE')
    }
  }
  private async read(p: ReturnType<typeof SourceContentParams.parse>, access?: SourceReadScope) {
    const before = await this.snapshot(p, access)
    const scope = cursorScope(['message.source.get', p.resource, p.referenceId, p.historyVersion,
      p.turnId, p.messageId, access?.scope ?? 'personal'])
    const position = readCursor<Position>(p.cursor, scope, { offset: 0, fingerprint: before.fingerprint })
    if (!Number.isSafeInteger(position.offset) || position.offset < 0 || !/^[a-f0-9]{64}$/.test(position.fingerprint) ||
      Object.keys(position).some((key) => !['offset', 'fingerprint'].includes(key))) throw new Error('INVALID_CURSOR')
    if (position.fingerprint !== before.fingerprint) throw new Error('HISTORY_CHANGED')
    let page
    try {
      page = await before.source.page(p.referenceId, { threadId: p.resource.id, turnId: p.turnId,
        itemId: p.messageId, contentOffset: position.offset, limit: 1 })
    } catch {
      // The source service owns paths and parser diagnostics. Remote callers receive only fixed codes.
      await this.snapshot(p, access)
      throw new Error('SOURCE_HISTORY_UNAVAILABLE')
    }
    const after = await this.snapshot(p, access)
    if (before.fingerprint !== after.fingerprint || page.status === 'changed') throw new Error('HISTORY_CHANGED')
    if (page.status === 'missing') throw new Error('SOURCE_HISTORY_MISSING')
    if (page.status !== 'available') throw new Error('SOURCE_HISTORY_UNAVAILABLE')
    const content = page.content, item = page.turns.find((turn) => turn.id === p.turnId)?.items.find((item) => item.id === p.messageId)
    if (!content || !item) throw new Error('NOT_FOUND')
    if (item.sourceHistoryOrder?.referenceId !== p.referenceId || !['text', 'arguments', 'output'].includes(content.field) ||
      content.itemId !== p.messageId || content.offset !== position.offset || !Number.isSafeInteger(content.totalChars) ||
      content.totalChars < position.offset || content.text.length > 16384 || content.offset + content.text.length > content.totalChars)
      throw new Error('SOURCE_HISTORY_UNAVAILABLE')
    // Source APIs use UTF-16 offsets. Leave an incomplete trailing pair for the next exact source read.
    const rawText = /[\uD800-\uDBFF]$/.test(content.text) ? content.text.slice(0, -1) : content.text
    const text = Array.from(rawText).slice(0, p.maxChars).join(''), offset = position.offset, end = offset + text.length
    if (end === offset && end < content.totalChars) throw new Error('SOURCE_HISTORY_UNAVAILABLE')
    const hasMore = end < content.totalChars
    return { resource: p.resource, referenceId: p.referenceId, historyVersion: p.historyVersion, turnId: p.turnId, messageId: p.messageId,
      content: { field: content.field as 'text' | 'arguments' | 'output', text, offset, totalChars: content.totalChars,
        ...(hasMore ? { nextOffset: end } : {}) }, hasMore, ...(hasMore ? { nextCursor: writeCursor(scope, { offset: end, fingerprint: before.fingerprint }) } : {}) }
  }
}
