import { basename, extname } from 'node:path'
import type { AgentArtifact, AgentArtifactVersion } from '../../../contracts/agent-artifacts.js'
import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import { privateAgentSource, requireAgent } from '../access.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { cursorScope, readCursor, writeCursor } from '../../cursor-codec.js'
export async function readableAgentRoom(runtime: ServerRuntime, agentId: string, roomId: string) {
  await requireAgent(runtime.rooms!, agentId)
  const room = await privateAgentSource(runtime.rooms!, agentId, roomId, [], false, true)
  if (room.deletedAt) throw new RemoteNoEffect('NOT_FOUND')
  return room
}
export async function readableAgentArtifact(runtime: ServerRuntime, agentId: string, artifactId: string, version?: number) {
  await requireAgent(runtime.rooms!, agentId)
  const artifact = await runtime.rooms!.artifactLibrary.get(agentId, artifactId, version).catch(() => null)
  if (!artifact) throw new RemoteNoEffect('NOT_FOUND')
  await readableAgentRoom(runtime, agentId, artifact.roomId)
  return artifact
}
export function artifactDownloadName(meta: Pick<AgentArtifact, 'title' | 'relativePath'>) {
  const extension = extname(meta.relativePath).toLowerCase()
  const suffix = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
  // eslint-disable-next-line no-control-regex -- artifact names drop ASCII controls
  const candidate = basename(meta.title.replace(/\\/g, '/')).replace(/[\u0000-\u001F\u007F]/g, '').trim()
  const name = !candidate || candidate === '.' || candidate === '..' ? 'artifact' : candidate
  const prefix = suffix && name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name
  let safe = prefix.slice(0, 180 - suffix.length)
  if (/[\uD800-\uDBFF]$/.test(safe)) safe = safe.slice(0, -1)
  return safe + suffix
}
export function artifactMimeType(meta: Pick<AgentArtifact, 'mimeType'>) {
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(meta.mimeType) && meta.mimeType.length <= 120
    ? meta.mimeType : 'application/octet-stream'
}
export async function artifactBytesAvailable(runtime: ServerRuntime, meta: AgentArtifact | AgentArtifactVersion) {
  const store = runtime.rooms!.deps.artifacts
  if (!store || meta.byteSize < 1 || meta.byteSize > 25 * 1024 * 1024) return false
  // Metadata probes stay bounded; the export path validates exact bytes and SHA-256.
  for (const blob of meta.blobIds ?? [meta.blobId]) if (!await store.stat(blob)) return false
  return true
}
export function libraryCursor(method: string, filter: unknown, raw?: string) {
  const scope = cursorScope([method, filter])
  const value = readCursor<{ before?: number; incomplete?: boolean }>(raw, scope, {})
  if (value.before !== undefined && (!Number.isSafeInteger(value.before) || value.before < 0) ||
    value.incomplete !== undefined && typeof value.incomplete !== 'boolean') throw new RemoteNoEffect('INVALID_REQUEST')
  return { scope, ...value }
}
export function libraryPage(scope: string, before: number | undefined, hasMore: boolean, incomplete: boolean) {
  return { hasMore, complete: !hasMore && !incomplete, ...(hasMore ? { nextCursor: writeCursor(scope, { before, incomplete }) } : {}) }
}
