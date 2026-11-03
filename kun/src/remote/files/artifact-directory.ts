import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteArtifacts } from './artifacts.js'
import type {RemoteResource } from '../resources/contracts.js'
import { remoteResource, verifyResourceVersion } from '../resources/access.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
export class RemoteArtifactDirectory {
  constructor(private runtime: ServerRuntime, private artifacts: RemoteArtifacts) {}
  async list(p: { resource: RemoteResource; cursor?: string; limit?: number }) {
    const target = await remoteResource(this.runtime, p.resource), limit = p.limit ?? 20
    const scope = cursorScope(['artifact.list', p.resource, target.version])
    const position = readCursor<{ before?: string; offset?: number; itemId?: string }>(p.cursor, scope, {})
    if ((position.before !== undefined && typeof position.before !== 'string') ||
      (position.offset !== undefined && (!Number.isSafeInteger(position.offset) || position.offset < 0))) throw new Error('INVALID_CURSOR')
    if (p.resource.kind === 'agent') {
      if (position.before && !/^[0-9]+$/.test(position.before)) throw new Error('INVALID_CURSOR')
      const page = await this.runtime.rooms!.artifactLibrary.list(p.resource.id, { cursor: position.before, limit })
      return { artifacts: page.artifacts.map((a) => ({ resource: p.resource, id: a.artifactId, version: a.version,
        name: a.title, size: a.byteSize, mimeType: a.mimeType,
        available: this.runtime.rooms!.artifactLibrary.available && a.byteSize <= 25 * 1024 * 1024 })),
        hasMore: Boolean(page.nextCursor), ...(page.nextCursor ? { nextCursor: writeCursor(scope, { before: page.nextCursor }) } : {}) }
    }
    const load = this.runtime.sessionStore.loadItemPage
    if (!load) throw new Error('UNSUPPORTED_OPERATION')
    const artifacts = []
    let before = position.before, offset = position.offset ?? 0, hasMore = false, scanned = 0, next = position
    while (artifacts.length < limit && scanned < 100) {
      const page = await load.call(this.runtime.sessionStore, p.resource.id, { before, maxItems: 1, maxBytes: 256 * 1024 })
      const item = page.items.at(-1)
      if (!item) { hasMore = false; break }
      if (item.id === before) throw new Error('INVALID_CURSOR')
      if (position.itemId && scanned === 0 && item.id !== position.itemId) throw new Error('HISTORY_CHANGED')
      const files = await this.artifacts.codeHistory({ id: p.resource.id, turns: [{ items: [item] }] })
      const selected = files.slice(offset, offset + limit - artifacts.length)
      artifacts.push(...selected.map((file) => ({ ...file, resource: p.resource, threadId: p.resource.id })))
      if (offset + selected.length < files.length) {
        hasMore = true; next = { before, offset: offset + selected.length, itemId: item.id }; break
      }
      before = item.id; offset = 0; scanned++; hasMore = page.hasMore; next = { before }
      if (!hasMore) break
    }
    await verifyResourceVersion(this.runtime, p.resource, target.version)
    return { artifacts, hasMore, ...(hasMore ? { nextCursor: writeCursor(scope, next) } : {}) }
  }
}
