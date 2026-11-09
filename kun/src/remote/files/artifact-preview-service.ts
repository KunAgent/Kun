import { realpath } from 'node:fs/promises'
import type { ArtifactPreviewExportParams, ArtifactSummary, ArtifactWidgetState, ResourceRef } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteScope } from '../contracts.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { remoteResource, verifyResourceVersion } from '../resources/access.js'
import { readableAgentArtifact } from '../agents/library/access.js'
import { artifactText, record, type ArtifactSource, type ArtifactToolItem } from './artifact-sources.js'
import { artifactSourceWindow } from './artifact-history-window.js'
import { artifactIdentity, prepareArtifact, unavailableArtifact, type PreparedArtifact } from './artifact-preview-factory.js'

const TTL = 2 * 60 * 1000
interface Snapshot { value: PreparedArtifact; resourceVersion: string; expires: number; retainedBytes: number }
interface Position { before?: string; offset?: number; itemId?: string; signature?: string }
const identity = (scope: RemoteScope, resource: ResourceRef) => JSON.stringify([
  scope.accountId, scope.deviceId, scope.authorizationId, resource.kind, resource.id
])

/** Fixed, read-only projections of delivered artifacts; handles never accept caller filesystem paths. */
export class RemoteArtifactPreviews {
  private snapshots = new Map<string, Snapshot>()

  constructor(private runtime: ServerRuntime) {
    runtime.registerRemoteCleanup?.(async () => { this.snapshots.clear() })
  }

  private key(scope: RemoteScope, resource: ResourceRef, id: string, revision: string) {
    return `${identity(scope, resource)}:${id}:${revision}`
  }

  private prune() {
    const now = Date.now()
    for (const [key, snapshot] of this.snapshots) if (snapshot.expires <= now) this.snapshots.delete(key)
    let bytes = [...this.snapshots.values()].reduce((sum, snapshot) => sum + snapshot.retainedBytes, 0)
    while (this.snapshots.size > 64 || bytes > 64 * 1024 * 1024) {
      const key = this.snapshots.keys().next().value!
      bytes -= this.snapshots.get(key)!.retainedBytes
      this.snapshots.delete(key)
    }
  }

  private async root(resource: ResourceRef) {
    const target = await remoteResource(this.runtime, resource)
    const root = await realpath(target.thread?.workspace ?? this.runtime.rooms!.deps.dataDir)
    return { target, root }
  }

  private async completeItem(threadId: string, item: ArtifactToolItem) {
    if (!record(item.output)?.__timelineTruncated || !item.turnId) return item
    const load = this.runtime.sessionStore.loadItemPage
    if (!load) throw new Error('UNSUPPORTED_OPERATION')
    const parts: string[] = []
    let offset = 0, total = 0
    for (let page = 0; page < 128; page++) {
      const result = await load.call(this.runtime.sessionStore, threadId, {
        turnId: item.turnId, itemId: item.id, contentOffset: offset, maxItems: 1, maxBytes: 64 * 1024
      })
      const content = result.content
      if (!content || content.itemId !== item.id || content.field !== 'output' || content.offset !== offset ||
        content.totalChars > 2 * 1024 * 1024 || page > 0 && content.totalChars !== total) throw new Error('ARTIFACT_DOCUMENT_LIMIT')
      total = content.totalChars
      parts.push(content.text)
      if (content.nextOffset === undefined) {
        const text = parts.join('')
        if (text.length !== total) throw new Error('HISTORY_CHANGED')
        return { ...item, output: JSON.parse(text) as unknown }
      }
      if (content.nextOffset <= offset) throw new Error('HISTORY_CHANGED')
      offset = content.nextOffset
    }
    throw new Error('ARTIFACT_DOCUMENT_LIMIT')
  }

  private async summary(scope: RemoteScope, resource: ResourceRef, root: string, resourceVersion: string, source: ArtifactSource) {
    try {
      const value = await prepareArtifact(this.runtime, resource, root, source)
      await verifyResourceVersion(this.runtime, resource, resourceVersion)
      this.snapshots.set(this.key(scope, resource, value.preview.artifact.id, value.preview.artifact.revision), {
        value, resourceVersion, expires: Date.now() + TTL,
        retainedBytes: value.bundle.retainedBytes + Buffer.byteLength(JSON.stringify(source), 'utf8')
      })
      this.prune()
      return value.preview.artifact
    } catch (error) {
      if (error instanceof Error && error.message === 'HISTORY_CHANGED') throw error
      return unavailableArtifact(resource, source)
    }
  }

  async list(scope: RemoteScope, p: { resource: ResourceRef; cursor?: string; limit?: number }) {
    this.prune()
    const { target, root } = await this.root(p.resource), limit = p.limit ?? 20
    const cursor = cursorScope(['artifact.catalog.list', identity(scope, p.resource), target.version])
    const position = readCursor<Position>(p.cursor, cursor, {})
    if (position.before !== undefined && typeof position.before !== 'string' || position.offset !== undefined &&
      (!Number.isSafeInteger(position.offset) || position.offset < 0)) throw new Error('INVALID_CURSOR')
    if (p.resource.kind === 'agent') {
      const page = await this.runtime.rooms!.artifactLibrary.list(p.resource.id, { cursor: position.before, limit })
      const artifacts: ArtifactSummary[] = []
      for (const meta of page.artifacts) {
        try { await readableAgentArtifact(this.runtime, p.resource.id, meta.artifactId, meta.version) }
        catch { continue }
        const source: ArtifactSource = {
          key: `agent:${meta.artifactId}`, kind: 'file', title: artifactText(meta.title) || meta.artifactId,
          itemId: meta.artifactId, agentArtifact: { id: meta.artifactId, version: meta.version }
        }
        artifacts.push(await this.summary(scope, p.resource, root, target.version, source))
      }
      await verifyResourceVersion(this.runtime, p.resource, target.version)
      return { artifacts, hasMore: Boolean(page.nextCursor),
        ...(page.nextCursor ? { nextCursor: writeCursor(cursor, { before: page.nextCursor }) } : {}) }
    }
    const window = await artifactSourceWindow(this.runtime, p.resource.id, position.before, position.itemId,
      item => this.completeItem(p.resource.id, item))
    if (position.signature && position.signature !== window.signature) throw new Error('HISTORY_CHANGED')
    const offset = position.offset ?? 0
    if (offset > window.sources.length) throw new Error('INVALID_CURSOR')
    const artifacts: ArtifactSummary[] = []
    for (const source of window.sources.slice(offset, offset + limit))
      artifacts.push(await this.summary(scope, p.resource, root, target.version, source))
    const end = offset + artifacts.length
    const hasMore = end < window.sources.length || window.hasMore
    const next: Position = end < window.sources.length
      ? { before: position.before, offset: end, itemId: window.anchor, signature: window.signature }
      : { before: window.before }
    await verifyResourceVersion(this.runtime, p.resource, target.version)
    return { artifacts, hasMore, ...(hasMore ? { nextCursor: writeCursor(cursor, next) } : {}) }
  }

  private async recover(scope: RemoteScope, p: { resource: ResourceRef; id: string; revision: string }) {
    const { target, root } = await this.root(p.resource)
    let before: string | undefined
    for (let window = 0; window < 16; window++) {
      let sources: ArtifactSource[], hasMore: boolean, next: string | undefined
      if (p.resource.kind === 'agent') {
        const page = await this.runtime.rooms!.artifactLibrary.list(p.resource.id, { cursor: before, limit: 100 })
        sources = page.artifacts.map(meta => ({
          key: `agent:${meta.artifactId}`, kind: 'file', title: artifactText(meta.title) || meta.artifactId,
          itemId: meta.artifactId, agentArtifact: { id: meta.artifactId, version: meta.version }
        }))
        hasMore = Boolean(page.nextCursor)
        next = page.nextCursor
      } else {
        const page = await artifactSourceWindow(this.runtime, p.resource.id, before, undefined,
          item => this.completeItem(p.resource.id, item))
        sources = page.sources
        hasMore = page.hasMore
        next = page.before
      }
      const source = sources.find(source => artifactIdentity(p.resource, source) === p.id)
      if (source) {
        const artifact = await this.summary(scope, p.resource, root, target.version, source)
        if (artifact.revision !== p.revision) throw new Error('ARTIFACT_CHANGED')
        return
      }
      if (!hasMore || !next || next === before) return
      before = next
    }
  }

  private async checked(scope: RemoteScope, p: { resource: ResourceRef; id: string; revision: string }, recover = true) {
    this.prune()
    const key = this.key(scope, p.resource, p.id, p.revision)
    if (recover && !this.snapshots.has(key)) await this.recover(scope, p)
    const snapshot = this.snapshots.get(key)
    if (!snapshot) throw new Error('REFRESH_ARTIFACTS')
    const current = await this.root(p.resource)
    if (current.root !== snapshot.value.root || current.target.version !== snapshot.resourceVersion) throw new Error('HISTORY_CHANGED')
    snapshot.expires = Date.now() + TTL
    this.snapshots.delete(key)
    this.snapshots.set(key, snapshot)
    return snapshot
  }

  async get(scope: RemoteScope, p: { resource: ResourceRef; id: string; revision: string }) {
    return (await this.checked(scope, p)).value.preview
  }

  async asset(scope: RemoteScope, p: ArtifactPreviewExportParams) {
    const snapshot = await this.checked(scope, { resource: p.previewResource, id: p.previewId, revision: p.previewRevision }, false)
    const record = snapshot.value.bundle.records.get(p.previewAssetId)
    if (!record) throw new Error('FILE_NOT_ALLOWED')
    const data = await record.read()
    await verifyResourceVersion(this.runtime, p.previewResource, snapshot.resourceVersion)
    return { data, name: record.asset.name, mimeType: record.asset.mimeType }
  }

  async updateWidgetState(scope: RemoteScope, p: { resource: ResourceRef; id: string; revision: string; state: ArtifactWidgetState }) {
    const snapshot = await this.checked(scope, p, false), widget = snapshot.value.source.widget
    if (!widget || p.resource.kind !== 'code' || !this.runtime.genUi?.store) throw new Error('ARTIFACT_STATE_NOT_ALLOWED')
    const entry = await this.runtime.genUi.store.writeState(p.resource.id, widget.widgetId, p.state)
    await verifyResourceVersion(this.runtime, p.resource, snapshot.resourceVersion)
    snapshot.value.preview.widgetState = entry.state
    return { state: entry.state, updatedAt: entry.updatedAt }
  }
}
