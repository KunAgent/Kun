import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { readRoomRepositoryFile } from '../../rooms/room-file-content.js'
import { requireCode } from '../code/access.js'
import { readableAgentArtifact, artifactDownloadName, artifactMimeType } from '../agents/library/access.js'
const MAX = 25 * 1024 * 1024
type FileEntry = { id: string; name: string; size: number; mimeType: string; available: boolean }
const types: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.csv': 'text/csv',
  '.json': 'application/json'
}
function payloads(value: unknown, depth = 0): Record<string, unknown>[] {
  if (typeof value === 'string') {
    try {
      return payloads(JSON.parse(value), depth)
    } catch {
      return []
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2)
    return []
  const p = value as Record<string, unknown>
  return [
    p,
    ...payloads(p.result, depth + 1),
    ...payloads(p.content, depth + 1)
  ]
}
/** Bounded, host-issued handles. A phone never submits an arbitrary filesystem path. */
export class RemoteArtifacts {
  private handles = new Map<
    string,
    { threadId: string; root: string; path: string }
  >()
  constructor(private runtime: ServerRuntime) {}
  async codeHistory(history: any) {
    const thread = await requireCode(this.runtime, history.id)
    const root = await realpath(thread.workspace).catch(() => null), files: FileEntry[] = []
    if (!root) return files
    for (const turn of history.turns ?? [])
      for (const item of turn.items ?? []) {
        if (item.kind !== 'tool_result' || item.isError) continue
        for (const p of payloads(item.output))
          for (const file of [
            ...(Array.isArray(p.generatedFiles) ? p.generatedFiles : []),
            ...(Array.isArray(p.generatedArtifacts) ? p.generatedArtifacts : [])
          ]) {
            if (!file || typeof file !== 'object' || files.length >= 64)
              continue
            const candidate =
              file.absolutePath ?? file.path ?? file.relativePath
            if (typeof candidate !== 'string') continue
            try {
              const absolute = await realpath(resolve(root, candidate)),
                path = relative(root, absolute)
              if (isAbsolute(path) || path === '..' || path.startsWith('../'))
                continue
              const info = await stat(absolute)
              if (!info.isFile()) continue
              const id = createHash('sha256')
                .update(thread.id + ':' + item.id + ':' + path)
                .digest('hex')
              this.handles.delete(id)
              this.handles.set(id, { threadId: thread.id, root, path })
              while (this.handles.size > 256)
                this.handles.delete(this.handles.keys().next().value!)
              files.push({
                id,
                name: basename(path),
                size: info.size,
                mimeType:
                  types[extname(path).toLowerCase()] ??
                  'application/octet-stream',
                available: info.size <= MAX
              })
            } catch {
              /* Missing or out-of-workspace results are not file capabilities. */
            }
          }
      }
    return files
  }
  async readCode(threadId: string, id: string) {
    const thread = await requireCode(this.runtime, threadId)
    const handle = this.handles.get(id)
    if (!handle || handle.threadId !== threadId)
      throw new Error('REFRESH_HISTORY')
    if (await realpath(thread.workspace).catch(() => null) !== handle.root)
      throw new Error('REFRESH_HISTORY')
    const file = await readRoomRepositoryFile(
      { canonicalRoot: handle.root },
      handle.path,
      MAX + 1
    )
    if (file.size > MAX || file.data.length !== file.size)
      throw new Error('FILE_LIMIT')
    return {
      data: file.data,
      name: basename(handle.path),
      mimeType:
        types[extname(handle.path).toLowerCase()] ?? 'application/octet-stream'
    }
  }
  async readAgent(agentId: string, id: string, version?: number) {
    const library = this.runtime.rooms!.artifactLibrary,
      meta = await readableAgentArtifact(this.runtime, agentId, id, version)
    if (meta.byteSize > MAX) throw new Error('FILE_LIMIT')
    const { data } = await library.read(agentId, id, version)
    await readableAgentArtifact(this.runtime, agentId, id, version)
    return { data, name: artifactDownloadName(meta), mimeType: artifactMimeType(meta) }
  }
}
