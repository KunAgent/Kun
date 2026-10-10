import { mkdir, readFile, rename, rm, readdir, open, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ArtManifest } from '../../shared/kun-art'
import { verifyEnvelope, verifyFile } from './verification'
export type ArtPointer = { active: string | null; previous: string | null }
const empty = (): ArtPointer => ({ active: null, previous: null })
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
export class ArtStorage {
  constructor(readonly root: string, private readonly publicKey?: string) {}
  async initialize(): Promise<void> {
    for (const directory of ['objects', 'manifests', 'staging']) await mkdir(join(this.root, directory), { recursive: true })
    for (const name of await readdir(join(this.root, 'staging'))) await rm(join(this.root, 'staging', name), { force: true, recursive: true })
  }
  async pointer(): Promise<ArtPointer> {
    try {
      const p = JSON.parse(await readFile(join(this.root, 'active.json'), 'utf8'))
      // Older files also carry rollback bookkeeping that nothing reads any more.
      if (!(p.active === null || id(p.active)) || !(p.previous === null || id(p.previous))) return empty()
      return { active: p.active, previous: p.previous }
    } catch { return empty() }
  }
  async atomic(path: string, bytes: Uint8Array): Promise<void> {
    const temp = join(this.root, 'staging', randomUUID())
    try {
      const handle = await open(temp, 'wx', 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await rename(temp, path)
    } finally { await rm(temp, { force: true }).catch(() => undefined) }
  }
  async savePointer(pointer: ArtPointer): Promise<void> {
    await this.atomic(join(this.root, 'active.json'), Buffer.from(JSON.stringify(pointer)))
  }
  /** The local calendar day of the last update check that got an answer, or null. */
  async checkedDay(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(join(this.root, 'checked.json'), 'utf8'))
      return typeof value.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.day) ? value.day : null
    } catch { return null }
  }
  async saveCheckedDay(day: string): Promise<void> {
    await this.atomic(join(this.root, 'checked.json'), Buffer.from(JSON.stringify({ day })))
  }
  filePath(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid_hash')
    return join(this.root, 'objects', `${hash}.webp`)
  }
  async verifiedFile(manifest: ArtManifest, path: string): Promise<Buffer> {
    const file = manifest.files[path]
    if (!file) throw new Error('unknown_file')
    const disk = this.filePath(file.sha256), info = await lstat(disk)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error('invalid_file')
    const bytes = await readFile(disk); verifyFile(bytes, file); return bytes
  }
  async load(releaseId: string): Promise<ArtManifest> {
    if (!id(releaseId)) throw new Error('invalid_release')
    const path = join(this.root, 'manifests', `${releaseId}.json`), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('invalid_manifest')
    const manifest = verifyEnvelope(await readFile(path), this.publicKey)
    if (manifest.releaseId !== releaseId) throw new Error('release_mismatch')
    for (const path of Object.keys(manifest.files)) await this.verifiedFile(manifest, path)
    return manifest
  }
  async saveManifest(manifest: ArtManifest, envelope: Uint8Array): Promise<void> {
    await this.atomic(join(this.root, 'manifests', `${manifest.releaseId}.json`), envelope)
  }
  async collect(keep: ArtManifest[]): Promise<void> {
    const hashes = new Set(keep.flatMap(m => Object.values(m.files).map(f => `${f.sha256}.webp`)))
    for (const name of await readdir(join(this.root, 'objects'))) if (!hashes.has(name)) await rm(join(this.root, 'objects', name), { force: true })
    const manifests = new Set(keep.map(m => `${m.releaseId}.json`))
    for (const name of await readdir(join(this.root, 'manifests'))) if (!manifests.has(name)) await rm(join(this.root, 'manifests', name), { force: true })
  }
}
