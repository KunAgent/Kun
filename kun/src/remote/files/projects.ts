import { homedir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { opendir, realpath, stat } from 'node:fs/promises'
import type { Dir } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteScope } from '../contracts.js'
import { projects } from './project-directory.js'
import { FILE_MAX_BYTES, inside, fileRevision, rootRevision, checkedProjectRead } from './project-content.js'
const TTL = 10 * 60 * 1000
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.md': 'text/markdown',
  '.txt': 'text/plain', '.html': 'text/html', '.csv': 'text/csv' }
// These are credential/configuration authorities, not source-code exclusions.
const PRIVATE = new Set(['.git', '.codex', '.claude', '.gemini', '.ssh', '.aws', '.azure', '.gnupg', '.npmrc', '.netrc', '.pypirc',
  '.git-credentials', '.docker', '.kube', 'credentials.json', 'service-account.json'])
type Entry = { fileRef: string; name: string; kind: 'file' | 'directory'; revision: string;
  available: boolean; size?: number; mimeType?: string; displayPath?: string; parentRef?: string }
type Handle = { scope: string; projectId: string; root: string; rootVersion: string; path: string; entry: Entry; expires: number }
type Scan = { scope: string; projectId: string; root: string; rootVersion: string; rootRef: string; parentRef?: string;
  query?: string; mode?: 'name' | 'content'; pending: string[]; directory?: Dir; currentPath?: string;
  content?: { handle: Handle; offset: number; tail: string; decoder: StringDecoder }; expires: number; busy: boolean }
function scopeKey(scope: RemoteScope) { return JSON.stringify([scope.accountId, scope.deviceId, scope.authorizationId]) }
export class RemoteProjectFiles {
  private handles = new Map<string, Handle>()
  private scans = new Map<string, Scan>()
  private pages = new Map<string, { scan: Scan; limit: number; value: unknown; expires: number }>()
  private expiryTimer?: NodeJS.Timeout
  private closed = false
  constructor(private runtime: ServerRuntime) {
    runtime.registerRemoteCleanup?.(() => this.close())
  }
  async close() {
    this.closed = true
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    const directories = [...new Set([...this.scans.values()].map((scan) => scan.directory).filter((dir): dir is Dir => Boolean(dir)))]
    this.scans.clear(); this.pages.clear(); this.handles.clear()
    await Promise.allSettled(directories.map((dir) => dir.close()))
  }
  private armExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    if (this.closed || !this.scans.size) return
    const next = Math.min(...[...this.scans.values()].map((scan) => scan.expires))
    this.expiryTimer = setTimeout(() => { try { this.prune() } catch {} this.armExpiry() }, Math.max(1000, next - Date.now() + 1))
    this.expiryTimer.unref()
  }
  private prune() {
    if (this.closed) throw new Error('FILE_NOT_ALLOWED')
    const now = Date.now()
    for (const [id, row] of this.pages) if (row.expires < now) this.pages.delete(id)
    while (this.pages.size >= 64) this.pages.delete(this.pages.keys().next().value!)
    for (const [id, row] of this.handles) if (row.expires < now) this.handles.delete(id)
    for (const [id, row] of this.scans) if (row.expires < now && !row.busy) {
      this.scans.delete(id); void row.directory?.close().catch(() => {})
    }
    while (this.handles.size >= 4096) this.handles.delete(this.handles.keys().next().value!)
    while (this.scans.size >= 32) {
      const found = [...this.scans].find(([, row]) => !row.busy)
      if (!found) throw new Error('BACKPRESSURE')
      const [id, row] = found
      this.scans.delete(id); void row.directory?.close().catch(() => {})
    }
  }
  private async root(projectId: string) {
    const project = (await projects(this.runtime)).find((p) => p.id === projectId)
    if (!project) throw new Error('NOT_FOUND')
    return { root: project.path, rootVersion: rootRevision(await stat(project.path)) }
  }
  private async permitted(root: string, path: string) {
    const canonical = await realpath(path)
    if (!inside(root, canonical)) return false
    if (PRIVATE.has(basename(root).toLowerCase())) return false
    const parts = relative(root, canonical).split(/[\\/]/)
    if (parts.some((part, i) => part.toLowerCase() === '.kun' && ['control', 'credentials'].includes(parts[i + 1]?.toLowerCase()))) return false
    if (parts.some((part) => PRIVATE.has(part.toLowerCase()) || part.toLowerCase() === '.env' || part.toLowerCase().startsWith('.env.'))) return false
    const protectedPaths = [this.runtime.rooms!.deps.dataDir, ...(this.runtime.remoteProtectedPaths ?? []),
      ...['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.claude', '.gemini'].map((name) => join(homedir(), name)),
      join(homedir(), '.kun', 'control'), join(homedir(), '.codex', 'auth.json'), join(homedir(), '.codex', 'config.toml')]
    for (const protectedPath of protectedPaths) {
      const candidate = await realpath(protectedPath).catch(() => resolve(protectedPath))
      if (inside(candidate, canonical)) return false
    }
    return true
  }
  private async issue(scan: Pick<Scan, 'scope' | 'projectId' | 'root' | 'rootVersion'>, path: string, parentRef?: string) {
    if (!await this.permitted(scan.root, path)) return null
    const info = await stat(await realpath(path))
    if (!info.isDirectory() && !info.isFile()) return null
    const entry: Entry = { fileRef: 'file_' + randomUUID().replaceAll('-', ''), name: basename(path),
      kind: info.isDirectory() ? 'directory' : 'file', revision: fileRevision(info), parentRef,
      displayPath: relative(scan.root, path), available: info.isDirectory() || info.size > 0 && info.size <= FILE_MAX_BYTES,
      ...(info.isFile() ? { size: info.size, mimeType: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' } : {}) }
    this.prune()
    const handle = { ...scan, path, entry, expires: Date.now() + TTL }
    this.handles.set(entry.fileRef, handle)
    return handle
  }
  private async validate(scope: RemoteScope, projectId: string, fileRef: string, revision?: string) {
    this.prune()
    const handle = this.handles.get(fileRef), root = await this.root(projectId)
    if (!handle || handle.scope !== scopeKey(scope) || handle.projectId !== projectId ||
      handle.root !== root.root || handle.rootVersion !== root.rootVersion ||
      revision && revision !== handle.entry.revision || !await this.permitted(root.root, handle.path) ||
      fileRevision(await stat(await realpath(handle.path))) !== handle.entry.revision) throw new Error('FILE_NOT_ALLOWED')
    return handle
  }
  async preview(scope: RemoteScope, p: { projectId: string; fileRef: string; expectedRevision: string }) {
    const handle = await this.validate(scope, p.projectId, p.fileRef, p.expectedRevision)
    if (handle.entry.kind !== 'file') throw new Error('FILE_NOT_ALLOWED')
    return { file: handle.entry, export: { projectId: p.projectId, fileRef: p.fileRef, revision: p.expectedRevision } }
  }
  async read(scope: RemoteScope, projectId: string, fileRef: string, revision: string) {
    const handle = await this.validate(scope, projectId, fileRef, revision)
    if (!handle.entry.available || handle.entry.kind !== 'file') throw new Error('FILE_NOT_ALLOWED')
    const result = await checkedProjectRead(handle.root, handle.path, revision, 0, FILE_MAX_BYTES, (path) => this.permitted(handle.root, path))
    await this.validate(scope, projectId, fileRef, revision)
    return { ...result, mimeType: handle.entry.mimeType ?? 'application/octet-stream' }
  }
  async page(scope: RemoteScope, p: { projectId: string; parentRef?: string; cursor?: string; limit: number;
    query?: string; mode?: 'name' | 'content' }) {
    this.prune()
    let scan: Scan, cursor = p.cursor
    if (cursor) {
      const cached = this.pages.get(cursor)
      const old = this.scans.get(cursor) ?? cached?.scan, current = await this.root(p.projectId)
      if (!old || old.scope !== scopeKey(scope) || old.projectId !== p.projectId || old.parentRef !== p.parentRef ||
        old.query !== p.query || old.mode !== p.mode || old.root !== current.root || old.rootVersion !== current.rootVersion)
        throw new Error('INVALID_CURSOR')
      if (cached) {
        if (cached.limit !== p.limit) throw new Error('INVALID_CURSOR')
        return cached.value as { projectId: string; rootRef: string; parentRef?: string; entries: Entry[];
          hasMore: boolean; nextCursor?: string; scanned: number; complete: boolean; searchScope: string }
      }
      scan = old
    } else {
      const root = await this.root(p.projectId), key = scopeKey(scope)
      const base = p.parentRef ? await this.validate(scope, p.projectId, p.parentRef) : null
      if (base && base.entry.kind !== 'directory') throw new Error('FILE_NOT_ALLOWED')
      const issued = await this.issue({ ...root, scope: key, projectId: p.projectId }, root.root)
      if (!issued) throw new Error('FILE_NOT_ALLOWED')
      scan = { ...root, scope: key, projectId: p.projectId, rootRef: issued.entry.fileRef,
        parentRef: p.parentRef, pending: [base?.path ?? root.root], query: p.query, mode: p.mode,
        expires: Date.now() + TTL, busy: false }
      cursor = 'scan_' + randomUUID().replaceAll('-', ''); this.scans.set(cursor, scan)
    }
    if (scan.busy) throw new Error('BACKPRESSURE')
    scan.busy = true
    const entries: Entry[] = [], deadline = Date.now() + 1000
    let scanned = 0, bytes = 0
    try {
      while (entries.length < p.limit && scanned < 512 && bytes < 1024 * 1024 && Date.now() < deadline) {
        if (this.closed) throw new Error('FILE_NOT_ALLOWED')
        if (scan.content) {
          const current = scan.content
          const chunk = await checkedProjectRead(scan.root, current.handle.path, current.handle.entry.revision,
            current.offset, 64 * 1024, (path) => this.permitted(scan.root, path)).catch(() => null)
          if (!chunk || chunk.data.includes(0)) { scan.content = undefined; continue }
          bytes += chunk.data.length
          const decoded = current.offset + chunk.data.length >= chunk.size ? current.decoder.end(chunk.data) : current.decoder.write(chunk.data)
          const text = (current.tail + decoded).toLowerCase(), query = p.query!.toLowerCase()
          current.offset += chunk.data.length
          current.tail = text.slice(-Math.max(query.length + 4, 256))
          if (text.includes(query)) { entries.push(current.handle.entry); scan.content = undefined }
          else if (current.offset >= chunk.size) scan.content = undefined
          continue
        }
        if (!scan.directory) {
          const next = scan.pending.pop()
          if (!next) break
          if (!await this.permitted(scan.root, next)) continue
          scan.directory = await opendir(next); scan.currentPath = next
        }
        const dirent = await scan.directory.read()
        if (!dirent) { await scan.directory.close(); scan.directory = undefined; continue }
        scanned++
        const path = join(scan.currentPath!, dirent.name)
        const handle = await this.issue(scan, path, p.parentRef).catch(() => null)
        if (!handle) continue
        if (p.query !== undefined && dirent.isDirectory()) {
          if (scan.pending.length >= 2048) throw new Error('SEARCH_LIMIT_REACHED')
          scan.pending.push(path)
          continue
        }
        if (p.query === undefined || dirent.name.toLowerCase().includes(p.query.toLowerCase())) entries.push(handle.entry)
        else if (p.mode === 'content' && handle.entry.kind === 'file' && handle.entry.available)
          scan.content = { handle, offset: 0, tail: '', decoder: new StringDecoder('utf8') }
      }
      if (this.closed) throw new Error('FILE_NOT_ALLOWED')
      const currentRoot = await this.root(p.projectId)
      if (currentRoot.root !== scan.root || currentRoot.rootVersion !== scan.rootVersion) throw new Error('FILE_NOT_ALLOWED')
      const hasMore = Boolean(scan.directory || scan.pending.length || scan.content)
      this.scans.delete(cursor)
      const nextCursor = hasMore ? 'scan_' + randomUUID().replaceAll('-', '') : undefined
      if (nextCursor) this.scans.set(nextCursor, scan)
      scan.expires = Date.now() + TTL
      const value = { projectId: p.projectId, rootRef: scan.rootRef, parentRef: scan.parentRef, entries, hasMore,
        nextCursor, scanned, complete: !hasMore, searchScope: p.mode ?? 'name' }
      this.pages.set(cursor, { scan, limit: p.limit, value, expires: scan.expires })
      return value
    } catch (error) {
      this.scans.delete(cursor)
      await scan.directory?.close().catch(() => {})
      scan.directory = undefined
      throw error
    } finally { scan.busy = false; this.armExpiry() }
  }
}
