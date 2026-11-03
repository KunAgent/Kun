import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { AttachmentMetadata } from '../../contracts/attachments.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ShareActor } from './contracts.js'
import { SharedTaskJournal, shareDigest } from './journal.js'
import { SharedTaskReceipts } from './receipts.js'
import { RemoteArtifacts } from '../files/artifacts.js'
import { SHARED_ITEM_KINDS, visibleSharedTurn } from './projection.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { SharedAttachmentId, SharedExportParams, SharedExportResult, SharedFileCallSchema, SharedFileListSchema,
  SHARED_FILE_MAX, type SharedAttachmentProof, type SharedFileEntry } from './files-contracts.js'

export const sharedAttachmentKey = (actor: ShareActor, threadId: string, attachmentId: string) => 'share-attachment_' +
  shareDigest([actor.ownerAccountId, actor.hostDeviceId, actor.shareId, actor.memberId, actor.guestAccountId, threadId, attachmentId])
const actorScope = (actor: ShareActor) => [actor.ownerAccountId, actor.hostDeviceId, actor.shareId, actor.memberId, actor.guestAccountId]
function safeAttachment(meta: AttachmentMetadata, name: string, createdAt: number) {
  const value: Record<string, unknown> = { name, createdAt: new Date(createdAt).toISOString(), updatedAt: new Date(createdAt).toISOString() }
  for (const key of ['id', 'kind', 'mimeType', 'byteSize', 'hash', 'width', 'height', 'documentFormat', 'pageCount', 'truncated'] as const)
    if (meta[key] !== undefined) value[key] = meta[key]
  return value
}
/** Independent custody proofs. Personal confirmations and workspace metadata never authorize a shared file. */
export class SharedTaskFiles {
  private artifacts: RemoteArtifacts
  private handles = new Map<string, { artifactId: string; historyVersion: string }>()
  constructor(private runtime: ServerRuntime, private journal: SharedTaskJournal, private receipts: SharedTaskReceipts) {
    this.artifacts = new RemoteArtifacts(runtime)
  }
  private async target(rawActor: unknown, threadId?: string) {
    const target = await this.journal.authorize(rawActor)
    if (threadId !== undefined && threadId !== target.resource.threadId) throw new Error('SHARE_RESOURCE_NOT_ALLOWED')
    return target
  }
  private visible(target: Awaited<ReturnType<SharedTaskFiles['target']>>, item: TurnItem) {
    const turn = target.thread.turns.find((candidate) => candidate.id === item.turnId)
    return item.threadId === target.thread.id && SHARED_ITEM_KINDS.has(item.kind) && Boolean(turn && visibleSharedTurn(target.actor, turn))
  }
  private async version(threadId: string) { return await this.runtime.sessionStore.itemHistoryVersion?.(threadId) ?? 'legacy' }
  private async proof(actor: ShareActor, threadId: string, attachmentId: string) {
    const row = await this.runtime.rooms!.deps.store.get<SharedAttachmentProof>('shared_attachment', sharedAttachmentKey(actor, threadId, attachmentId)), p = row?.value
    return p && p.attachmentId === attachmentId && p.threadId === threadId && p.memberVersion === actor.memberVersion &&
      p.ownerAccountId === actor.ownerAccountId && p.hostDeviceId === actor.hostDeviceId && p.shareId === actor.shareId &&
      p.memberId === actor.memberId && p.guestAccountId === actor.guestAccountId && p.resourceHandle === actor.resourceHandle ? p : null
  }
  private async name(actor: ShareActor, threadId: string, meta: AttachmentMetadata) {
    const own = await this.proof(actor, threadId, meta.id)
    if (own?.name) return own.name
    const extension: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
      'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'application/json': '.json' }
    // Content-addressed metadata may retain a name from an unrelated private upload of identical bytes.
    return 'attachment' + (extension[meta.mimeType] ?? '.bin')
  }
  private async references(actor: ShareActor, threadId: string, ids: Set<string>) {
    const target = await this.target(actor, threadId), version = await this.version(threadId)
    const load = this.runtime.sessionStore.loadItemPage
    if (!load) return ids
    let before: string | undefined
    const seen = new Set<string>(), deadline = Date.now() + 5000
    for (let pages = 0; pages < 100 && ids.size && Date.now() < deadline; pages++) {
      const page = await load.call(this.runtime.sessionStore, threadId, { before, maxItems: 200, maxBytes: 512 * 1024 })
      for (const item of page.items) if (this.visible(target, item) && 'attachmentIds' in item)
        for (const id of item.attachmentIds ?? []) ids.delete(id)
      if (!page.hasMore) break
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('HISTORY_UNAVAILABLE')
      before = page.nextCursor; seen.add(before)
    }
    if (version !== await this.version(threadId)) throw new Error('HISTORY_CHANGED')
    await this.target(actor, threadId)
    return ids
  }
  async assertInputs(rawActor: unknown, threadId: string, rawIds: unknown) {
    const { actor } = await this.target(rawActor, threadId)
    if (!Array.isArray(rawIds) || rawIds.length > 8) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
    if (rawIds.some((id) => !SharedAttachmentId.safeParse(id).success)) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
    const ids = [...new Set(rawIds as string[])], missing = new Set<string>()
    for (const id of ids) {
      if (!await this.runtime.attachmentStore?.get(id)) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
      if (!await this.proof(actor, threadId, id)) missing.add(id)
    }
    if (missing.size && (await this.references(actor, threadId, missing)).size) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
    await this.target(actor, threadId)
  }
  /** Host-authored per-turn metadata. Model/tool callers must never see global deduplicated names. */
  async inputAliases(rawActor: unknown, threadId: string, ids: readonly string[]) {
    await this.assertInputs(rawActor, threadId, ids)
    const { actor } = await this.target(rawActor, threadId), aliases = []
    for (const attachmentId of new Set(ids)) {
      const meta = await this.runtime.attachmentStore?.get(attachmentId)
      if (!meta) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
      // eslint-disable-next-line no-control-regex -- alias display names replace ASCII controls
      const name = basename((await this.name(actor, threadId, meta)).replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 180).trim()
      aliases.push({ attachmentId, displayName: name && !['.', '..'].includes(name) ? name : 'attachment', mimeType: meta.mimeType, byteSize: meta.byteSize })
    }
    await this.target(actor, threadId)
    return aliases
  }
  async list(rawActor: unknown, rawParams: unknown) {
    const p = SharedFileListSchema.parse(rawParams), target = await this.target(rawActor, p.resource.id), { actor, thread } = target
    const version = await this.version(thread.id), scope = cursorScope(['shared.artifacts', actorScope(actor), actor.memberVersion, thread.id, version])
    const position = readCursor<{ before?: string; offset?: number; itemId?: string }>(p.cursor, scope, {})
    if (position.before !== undefined && typeof position.before !== 'string' || position.offset !== undefined &&
      (!Number.isSafeInteger(position.offset) || position.offset < 0) || position.itemId !== undefined && typeof position.itemId !== 'string') throw new Error('INVALID_CURSOR')
    const load = this.runtime.sessionStore.loadItemPage
    if (!load) throw new Error('UNSUPPORTED_OPERATION')
    const artifacts: SharedFileEntry[] = [], seen = new Set<string>(), limit = p.limit ?? 20
    let before = position.before, offset = position.offset ?? 0, hasMore = false, next = position
    for (let scanned = 0; scanned < 100 && artifacts.length < limit; scanned++) {
      const page = await load.call(this.runtime.sessionStore, thread.id, { before, maxItems: 1, maxBytes: 256 * 1024 })
      const item = page.items.at(-1)
      if (!item) { hasMore = false; break }
      if (item.id === before || seen.has(item.id)) throw new Error('INVALID_CURSOR')
      seen.add(item.id)
      if (position.itemId && scanned === 0 && item.id !== position.itemId) throw new Error('HISTORY_CHANGED')
      const entries: SharedFileEntry[] = []
      if (this.visible(target, item)) {
        if ('attachmentIds' in item) for (const id of new Set(item.attachmentIds ?? [])) {
          const meta = await this.runtime.attachmentStore?.get(id)
          if (meta) entries.push({ resource: p.resource, threadId: thread.id, id, attachmentId: id, name: await this.name(actor, thread.id, meta),
            size: meta.byteSize, mimeType: meta.mimeType, available: meta.byteSize > 0 && meta.byteSize <= SHARED_FILE_MAX })
        }
        for (const file of await this.artifacts.codeHistory({ id: thread.id, turns: [{ items: [item] }] })) {
          const handle = shareDigest([actorScope(actor), file.id]), key = shareDigest([actorScope(actor), handle])
          this.handles.delete(key); this.handles.set(key, { artifactId: file.id, historyVersion: version })
          while (this.handles.size > 256) this.handles.delete(this.handles.keys().next().value!)
          entries.push({ ...file, id: handle, resource: p.resource, threadId: thread.id })
        }
      }
      const selected = entries.slice(offset, offset + limit - artifacts.length)
      artifacts.push(...selected)
      if (offset + selected.length < entries.length) { hasMore = true; next = { before, offset: offset + selected.length, itemId: item.id }; break }
      before = item.id; offset = 0; hasMore = page.hasMore; next = { before }
      if (!hasMore) break
    }
    if (version !== await this.version(thread.id)) throw new Error('HISTORY_CHANGED')
    await this.target(actor, thread.id)
    return { artifacts, hasMore, ...(hasMore ? { nextCursor: writeCursor(scope, next) } : {}) }
  }
  async content(rawActor: unknown, rawParams: unknown) {
    const p = SharedExportParams.parse(rawParams), { actor, thread } = await this.target(rawActor, p.threadId)
    let content: { data: Buffer; name: string; mimeType: string }
    if ('attachmentId' in p) {
      await this.assertInputs(actor, thread.id, [p.attachmentId])
      if (!this.runtime.attachmentStore) throw new Error('FILE_NOT_ALLOWED')
      const native = await this.runtime.attachmentStore.resolveContent(p.attachmentId, { threadId: thread.id, workspace: thread.workspace })
      content = { data: native.data, mimeType: native.mimeType, name: await this.name(actor, thread.id, native) }
    } else {
      const handle = this.handles.get(shareDigest([actorScope(actor), p.artifactId]))
      if (!handle || handle.historyVersion !== await this.version(thread.id)) throw new Error('REFRESH_HISTORY')
      content = await this.artifacts.readCode(thread.id, handle.artifactId)
    }
    if (!content.data.length || content.data.length > SHARED_FILE_MAX) throw new Error('FILE_LIMIT')
    await this.target(actor, thread.id)
    return { data: content.data, name: content.name, mimeType: content.mimeType }
  }
  async start(rawActor: unknown, rawCall: unknown) {
    const call = SharedFileCallSchema.parse(rawCall), { actor, thread } = await this.target(rawActor, 'threadId' in call.params ? call.params.threadId : undefined)
    if (call.method === 'attachment.receive' && actor.mode !== 'write') throw new Error('SHARE_READ_ONLY')
    // A known admission/result must remain recoverable even if the original artifact has since changed.
    const old = await this.receipts.get(actor, call.requestId)
    if (!old && call.method === 'attachment.export') await this.content(actor, call.params)
    await this.target(actor, thread.id)
    const result = await this.receipts.startExternal(actor, call)
    return 'started' in result ? { ...result, threadId: thread.id } : result
  }
  async finish(rawActor: unknown, rawCall: unknown, rawResult: unknown) {
    const call = SharedFileCallSchema.parse(rawCall), { actor, thread } = await this.target(rawActor, 'threadId' in call.params ? call.params.threadId : undefined)
    if (call.method === 'attachment.receive' && actor.mode !== 'write') throw new Error('SHARE_READ_ONLY')
    if (call.method === 'attachment.export') {
      const result = SharedExportResult.parse(rawResult)
      return this.receipts.finishExternal(actor, call, result, async (receipt) => {
        await this.target(actor, thread.id)
        if (receipt.origin.memberVersion !== actor.memberVersion) throw new Error('SHARE_AUTHORIZATION_STALE')
        const content = await this.content(actor, call.params)
        if (content.data.length !== result.size || createHash('sha256').update(content.data).digest('hex') !== result.sha256) throw new Error('FILE_INTEGRITY')
        return {}
      })
    }
    const id = (rawResult as { attachment?: { id?: unknown } } | null)?.attachment?.id
    const attachmentId = SharedAttachmentId.parse(id), metadata = await this.runtime.attachmentStore?.get(attachmentId)
    if (!metadata?.threadIds.includes(thread.id)) throw new Error('FILE_NOT_ALLOWED')
    const admitted = await this.receipts.get(actor, call.requestId)
    if (!admitted) throw new Error('RECEIPT_REQUIRED')
    return this.receipts.finishExternal(actor, call, { attachment: safeAttachment(metadata, call.params.name, admitted.createdAt) }, async (receipt) => {
      await this.target(actor, thread.id)
      if (receipt.origin.memberVersion !== actor.memberVersion) throw new Error('SHARE_AUTHORIZATION_STALE')
      const key = sharedAttachmentKey(actor, thread.id, attachmentId), old = await this.runtime.rooms!.deps.store.get<SharedAttachmentProof>('shared_attachment', key)
      const value: SharedAttachmentProof = { ownerAccountId: actor.ownerAccountId, hostDeviceId: actor.hostDeviceId,
        shareId: actor.shareId, resourceHandle: actor.resourceHandle, memberId: actor.memberId, guestAccountId: actor.guestAccountId,
        shareVersion: actor.shareVersion, memberVersion: actor.memberVersion, sourceDeviceId: actor.deviceId,
        threadId: thread.id, attachmentId, receiptId: call.requestId, confirmedAt: Date.now(), name: call.params.name }
      return { checks: [{ kind: 'shared_attachment', id: key, expectedRevision: old?.revision ?? null }],
        puts: [{ kind: 'shared_attachment', id: key, taskId: actor.shareId, value }] }
    })
  }
}
