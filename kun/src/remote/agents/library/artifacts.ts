import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { AgentArtifact, AgentArtifactVersion } from '../../../contracts/agent-artifacts.js'
import { AgentArtifactSchema, AgentArtifactVersionSchema } from '../../../contracts/agent-artifacts.js'
import { requireAgent } from '../access.js'
import { RemoteAgentRuns } from './runs.js'
import { readableAgentArtifact, readableAgentRoom, artifactDownloadName, artifactMimeType,
  artifactBytesAvailable, libraryCursor, libraryPage } from './access.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
export class RemoteAgentArtifacts {
  private readonly runs: RemoteAgentRuns
  constructor(private readonly runtime: ServerRuntime) { this.runs = new RemoteAgentRuns(runtime) }
  async project(agentId: string, raw: (AgentArtifact | AgentArtifactVersion) & { revision?: number }) {
    const { revision: _revision, ...value } = raw
    const parsed = value.status === 'version' ? AgentArtifactVersionSchema.parse(value) : AgentArtifactSchema.parse(value)
    await readableAgentRoom(this.runtime, agentId, parsed.roomId)
    const target = await this.runtime.rooms!.artifactLibrary.sourceTarget(parsed.roomId, parsed)
    let source: Awaited<ReturnType<RemoteAgentRuns['project']>>['source'] | undefined
    if (target) {
      try {
        const row = await this.runs.checked(agentId, target.runId), projected = await this.runs.project(agentId, row)
        const { messageId: _messageId, ...base } = projected.source
        source = { ...base, ...(target.messageId && target.messageId === projected.source.messageId ? { messageId: target.messageId } : {}) }
      } catch (error) { if (!(error instanceof RemoteNoEffect)) throw error }
    }
    return { id: parsed.artifactId, version: parsed.version, ...(raw.revision !== undefined ? { revision: raw.revision } : {}),
      name: artifactDownloadName(parsed), size: parsed.byteSize, sha256: parsed.sha256, mimeType: artifactMimeType(parsed),
      ...(parsed.status !== 'version' ? { status: parsed.status, updatedAt: parsed.updatedAt } : {}),
      createdAt: parsed.createdAt, available: await artifactBytesAvailable(this.runtime, parsed), ...(source ? { source } : {}) }
  }
  async get(p: any) {
    const meta = await readableAgentArtifact(this.runtime, p.agentId, p.artifactId, p.version)
    return { agentId: p.agentId, artifact: await this.project(p.agentId, meta) }
  }
  async list(p: any) {
    await requireAgent(this.runtime.rooms!, p.agentId)
    const page = libraryCursor('agent.artifacts.list', [p.agentId, p.archived, p.search ?? null], p.cursor)
    const artifacts = [], deadline = Date.now() + 1000
    let before = page.before, incomplete = Boolean(page.incomplete), hasMore = false
    for (let scanned = 0; scanned < 100 && artifacts.length < p.limit && Date.now() < deadline; scanned++) {
      const result = await this.runtime.rooms!.artifactLibrary.list(p.agentId, {
        archived: p.archived ? 'true' : 'false', search: p.search, cursor: before, limit: 1 })
      if (!result.artifacts.length) { hasMore = false; break }
      const item = result.artifacts[0]
      const row = await this.runtime.rooms!.deps.store.get('agent_artifact', item.artifactId)
      if (!row) { incomplete = true; hasMore = Boolean(result.nextCursor); if (!hasMore) break; before = Number(result.nextCursor); continue }
      before = result.nextCursor ? Number(result.nextCursor) : row.seq; hasMore = Boolean(result.nextCursor)
      try { artifacts.push(await this.project(p.agentId, item)) }
      catch (error) { if (!(error instanceof RemoteNoEffect)) throw error }
      if (!hasMore) break
    }
    return { agentId: p.agentId, artifacts, ...libraryPage(page.scope, before, hasMore, incomplete) }
  }
  async versions(p: any) {
    const head = await readableAgentArtifact(this.runtime, p.agentId, p.artifactId)
    const page = libraryCursor('agent.artifacts.versions', [p.agentId, p.artifactId, head.version, head.revision], p.cursor)
    const versions = [], deadline = Date.now() + 1000
    let before = page.before, hasMore = false, incomplete = Boolean(page.incomplete)
    for (let scanned = 0; scanned < 100 && versions.length < p.limit && Date.now() < deadline; scanned++) {
      const result = await this.runtime.rooms!.artifactLibrary.versions(p.agentId, p.artifactId, { cursor: before, limit: 1 })
      if (!result.versions.length) { hasMore = false; break }
      const item = result.versions[0], row = await this.runtime.rooms!.deps.store.get('agent_artifact', item.id)
      if (!row) { incomplete = true; hasMore = Boolean(result.nextCursor); if (!hasMore) break; before = Number(result.nextCursor); continue }
      before = row.seq; hasMore = Boolean(result.nextCursor)
      try { versions.push(await this.project(p.agentId, item)) }
      catch (error) { if (!(error instanceof RemoteNoEffect)) throw error }
      if (!hasMore) break
    }
    const current = await readableAgentArtifact(this.runtime, p.agentId, p.artifactId)
    if (current.revision !== head.revision) throw new RemoteNoEffect('REVISION_CONFLICT')
    return { agentId: p.agentId, artifactId: p.artifactId, currentVersion: head.version, revision: head.revision,
      versions, ...libraryPage(page.scope, before, hasMore, incomplete) }
  }
}
