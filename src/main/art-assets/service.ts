import type { ArtManifest, ArtState } from '../../shared/kun-art'
import { ArtStorage, type ArtPointer } from './storage'
import { compatible, hash, verifyEnvelope, verifyFile } from './verification'
const ISSUER = 'https://api-kun-server.com'
type Fetcher = (url: string, options: RequestInit) => Promise<Response>
export class ArtAssetService {
  private state: ArtState = { phase: 'bundled', manifest: null, completed: 0, total: 0, rollbackAvailable: false, held: false }
  private pointer: ArtPointer = { active: null, previous: null, rejected: [], held: false }
  private previous: ArtManifest | null = null
  private initialized?: Promise<void>
  private running?: Promise<ArtState>
  private rolling?: Promise<ArtState>
  private abort = new AbortController()
  private disposed = false
  private etag?: string
  constructor(private readonly deps: {
    storage: ArtStorage; fetch: Fetcher; appVersion: string; publicKey?: string
    changed(state: ArtState): void
    failed?(code: string): void
    activate(manifest: ArtManifest | null): Promise<void>
  }) {}
  private emit(patch: Partial<ArtState> = {}): void {
    const next = { ...this.state, ...patch }
    this.state = { ...next, rollbackAvailable: Boolean(next.manifest), held: this.pointer.held }
    if (!this.disposed) this.deps.changed(this.state)
  }
  async getState(): Promise<ArtState> {
    this.initialized ??= this.initialize()
    await this.initialized
    return this.state
  }
  private async initialize(): Promise<void> {
    await this.deps.storage.initialize()
    this.pointer = await this.deps.storage.pointer()
    let active: ArtManifest | null = null
    try { if (this.pointer.active) active = await this.deps.storage.load(this.pointer.active) } catch { /* Try previous below. */ }
    try { if (this.pointer.previous) this.previous = await this.deps.storage.load(this.pointer.previous) } catch { this.pointer.previous = null }
    if (active && !compatible(active, this.deps.appVersion)) active = null
    if (this.previous && !compatible(this.previous, this.deps.appVersion)) this.previous = null
    if (!active && this.pointer.active) {
      this.pointer.rejected = [...new Set([...this.pointer.rejected, this.pointer.active])].slice(-100)
      active = this.previous; this.previous = null
      this.pointer.active = active?.releaseId ?? null; this.pointer.previous = null
      await this.deps.storage.savePointer(this.pointer)
    }
    // Files remain usable offline even if the runtime has not started yet.
    await this.deps.activate(active).catch(() => undefined)
    this.emit({ manifest: active, phase: active ? 'ready' : 'bundled' })
  }
  async check(manual = false): Promise<ArtState> {
    if (this.rolling) return this.rolling
    if (this.running) return this.running
    this.running = this.update(manual).catch((error: unknown) => {
      const code = error instanceof Error && /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'update_failed'
      this.deps.failed?.(code)
      this.emit({ phase: 'error', error: '资源更新暂不可用，继续使用已有资源。' }); return this.state
    }).finally(() => { this.running = undefined })
    return this.running
  }
  private async get(url: string, max: number): Promise<Buffer> {
    if (this.disposed) throw new Error('disposed')
    const response = await this.deps.fetch(url, { redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]) })
    if (!response.ok || !response.body) throw new Error('download_failed')
    if (Number(response.headers.get('content-length') ?? 0) > max) throw new Error('download_too_large')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        length += value.length; if (length > max) throw new Error('download_too_large'); chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => undefined) }
    return Buffer.concat(chunks)
  }
  private async update(manual: boolean): Promise<ArtState> {
    await this.getState()
    if (this.pointer.held && !manual) return this.state
    this.emit({ phase: 'checking', error: undefined, completed: 0, total: 0 })
    const query = new URLSearchParams({ channel: 'stable', appVersion: this.deps.appVersion, schemaVersion: '1' })
    const response = await this.deps.fetch(`${ISSUER}/api/assets/releases/latest?${query}`, { headers: this.etag && !manual ? { 'If-None-Match': this.etag } : {}, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]) })
    if (response.status === 304) { await this.deps.activate(this.state.manifest); this.emit({ phase: this.state.manifest ? 'ready' : 'bundled' }); return this.state }
    if (response.status === 204) { this.emit({ phase: this.state.manifest ? 'ready' : 'bundled' }); return this.state }
    if (!response.ok) throw new Error('check_failed')
    // Bound the descriptor independently of server-provided headers.
    const reader = response.body?.getReader(); if (!reader) throw new Error('invalid_descriptor')
    const chunks: Uint8Array[] = []; let length = 0
    try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 8192) throw new Error('descriptor_too_large'); chunks.push(r.value) } }
    finally { await reader.cancel().catch(() => undefined) }
    const descriptor = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(descriptor.releaseId) || !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
        !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 2 * 1024 * 1024) throw new Error('invalid_descriptor')
    if (this.pointer.rejected.includes(descriptor.releaseId) && !manual) { this.emit({ phase: this.state.manifest ? 'ready' : 'bundled' }); return this.state }
    if (descriptor.releaseId === this.state.manifest?.releaseId) {
      await this.deps.activate(this.state.manifest)
      if (manual) { this.pointer.held = false; await this.deps.storage.savePointer(this.pointer) }
      this.emit({ phase: 'ready' }); return this.state
    }
    const envelope = await this.get(`${ISSUER}/art/releases/${descriptor.releaseId}.json`, descriptor.size)
    if (envelope.length !== descriptor.size || hash(envelope) !== descriptor.sha256) throw new Error('manifest_hash_mismatch')
    const manifest = verifyEnvelope(envelope, this.deps.publicKey)
    if (manifest.releaseId !== descriptor.releaseId || !compatible(manifest, this.deps.appVersion)) throw new Error('incompatible_release')
    await this.deps.storage.collect([this.state.manifest, this.previous, manifest].filter((m): m is ArtManifest => Boolean(m)))
    const paths = Object.keys(manifest.files)
    this.emit({ phase: 'downloading', total: paths.length })
    let next = 0, failed: unknown
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < paths.length && !failed && !this.disposed) {
        const path = paths[next++], file = manifest.files[path]
        try {
          try { await this.deps.storage.verifiedFile(manifest, path) } catch {
            const bytes = await this.get(`${ISSUER}/art/objects/${file.sha256}.webp`, file.size)
            verifyFile(bytes, file)
            await this.deps.storage.atomic(this.deps.storage.filePath(file.sha256), bytes)
          }
          this.emit({ completed: this.state.completed + 1 })
        } catch (error) { failed = error }
      }
    }))
    if (failed || this.disposed) throw failed ?? new Error('disposed')
    await this.deps.storage.saveManifest(manifest, envelope)
    // Runtime accepts the complete catalog before renderers see this version.
    await this.deps.activate(manifest)
    const old = this.state.manifest
    const pointer = { active: manifest.releaseId, previous: old?.releaseId ?? null,
      rejected: this.pointer.rejected.filter(id => id !== manifest.releaseId), held: false }
    try { await this.deps.storage.savePointer(pointer) } catch (error) { await this.deps.activate(old).catch(() => undefined); throw error }
    this.previous = old; this.pointer = pointer
    this.etag = `"${descriptor.sha256}"`
    this.emit({ phase: 'ready', manifest, error: undefined })
    // Keep current + previous; old render requests use a frozen manifest until the UI switches.
    return this.state
  }
  async rollback(): Promise<ArtState> {
    if (this.rolling) return this.rolling
    this.rolling = this.performRollback().finally(() => { this.rolling = undefined })
    return this.rolling
  }
  private async performRollback(): Promise<ArtState> {
    await this.getState(); await this.running
    const current = this.state.manifest
    if (this.previous) { try { this.previous = await this.deps.storage.load(this.previous.releaseId) } catch { this.previous = null } }
    await this.deps.activate(this.previous)
    const pointer = { active: this.previous?.releaseId ?? null, previous: null,
      rejected: [...new Set([...this.pointer.rejected, ...(current ? [current.releaseId] : [])])].slice(-100), held: true }
    try { await this.deps.storage.savePointer(pointer) } catch (error) { await this.deps.activate(current).catch(() => undefined); throw error }
    this.pointer = pointer
    this.etag = undefined
    this.emit({ phase: this.previous ? 'ready' : 'bundled', manifest: this.previous, error: undefined })
    this.previous = null
    return this.state
  }
  async resource(url: string): Promise<Buffer> {
    await this.getState()
    const parsed = new URL(url)
    if (parsed.protocol !== 'kun-asset:' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) throw new Error('invalid_asset_url')
    const manifest = [this.state.manifest, this.previous].find(m => m?.releaseId === parsed.hostname)
    if (!manifest) throw new Error('unknown_release')
    const path = parsed.pathname.slice(1)
    if (!manifest.files[path]) throw new Error('unknown_file')
    try { return await this.deps.storage.verifiedFile(manifest, path) } catch (error) {
      if (manifest === this.state.manifest) void this.rollback().catch(() => undefined)
      throw error
    }
  }
  async stop(): Promise<void> {
    this.dispose()
    await Promise.allSettled([this.initialized, this.running, this.rolling])
  }
  dispose(): void { this.disposed = true; this.abort.abort() }
}
