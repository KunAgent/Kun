import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, relative, resolve, sep } from 'node:path'
import type { ArtifactPreviewAsset } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { checkedProjectRead, FILE_MAX_BYTES, fileRevision, inside } from './project-content.js'
import { permittedProjectFile } from './project-file-permissions.js'
import { artifactMime } from './artifact-mime.js'

export const PREVIEW_MAX_ASSETS = 256
export const PREVIEW_MAX_BYTES = 64 * 1024 * 1024
export const artifactHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

export interface PreviewAssetRecord {
  asset: ArtifactPreviewAsset
  read(): Promise<Buffer>
}

/** Read-only bundle assembly. Every later export rechecks the source and exact content digest. */
export class ArtifactBundle {
  readonly records = new Map<string, PreviewAssetRecord>()
  readonly missing = new Set<string>()
  private paths = new Map<string, PreviewAssetRecord>()
  private bytes = 0
  private retained = 0

  constructor(private runtime: ServerRuntime, readonly root: string) {}

  async file(candidate: string, mime?: string): Promise<PreviewAssetRecord> {
    if (!candidate || candidate.includes('\0') || /[\r\n]/.test(candidate)) throw new Error('FILE_NOT_ALLOWED')
    const logical = resolve(this.root, candidate)
    if (!inside(this.root, logical)) throw new Error('FILE_NOT_ALLOWED')
    const path = await realpath(logical)
    if (!inside(this.root, path) || !await permittedProjectFile(this.runtime, this.root, path)) throw new Error('FILE_NOT_ALLOWED')
    const virtual = relative(this.root, logical).split(sep).join('/')
    const existing = this.paths.get(virtual)
    if (existing) return existing
    const info = await stat(path)
    if (!info.isFile() || info.size < 1 || info.size > FILE_MAX_BYTES) throw new Error('FILE_LIMIT')
    const revision = fileRevision(info)
    const read = async () => (await checkedProjectRead(this.root, logical, revision, 0, FILE_MAX_BYTES,
      value => permittedProjectFile(this.runtime, this.root, value))).data
    return this.add(virtual, await read(), mime ?? artifactMime(path), read)
  }

  async provided(path: string, read: () => Promise<Uint8Array>, mimeType: string) {
    const load = async () => Buffer.from(await read())
    return this.add(path, await load(), mimeType, load)
  }

  async metadata(candidate: string): Promise<unknown> {
    const path = await realpath(resolve(this.root, candidate))
    if (!inside(this.root, path) || !await permittedProjectFile(this.runtime, this.root, path)) throw new Error('FILE_NOT_ALLOWED')
    const info = await stat(path)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('FILE_LIMIT')
    const value = await checkedProjectRead(this.root, path, fileRevision(info), 0, 1024 * 1024,
      value => permittedProjectFile(this.runtime, this.root, value))
    return JSON.parse(value.data.toString('utf8'))
  }

  buffer(path: string, data: Uint8Array, mimeType: string): PreviewAssetRecord {
    const existing = this.paths.get(path)
    if (existing) return existing
    const bytes = Buffer.from(data)
    const record = this.add(path, bytes, mimeType, async () => Buffer.from(bytes))
    this.retained += bytes.length
    return record
  }

  json(path: string, value: unknown) {
    return this.buffer(path, Buffer.from(JSON.stringify(value), 'utf8'), 'application/json')
  }

  private add(path: string, data: Buffer, mimeType: string, read: () => Promise<Buffer>): PreviewAssetRecord {
    const existing = this.paths.get(path)
    if (existing) return existing
    if (!path || path.startsWith('/') || /[\\\x00-\x1f\x7f?#]/.test(path) ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('FILE_NOT_ALLOWED')
    if (!data.length || data.length > FILE_MAX_BYTES || this.records.size >= PREVIEW_MAX_ASSETS ||
      this.bytes + data.length > PREVIEW_MAX_BYTES) throw new Error('FILE_LIMIT')
    const sha256 = artifactHash(data)
    const asset: ArtifactPreviewAsset = {
      id: 'asset_' + artifactHash(`${path}\0${sha256}`).slice(0, 48),
      path, name: basename(path), mimeType, size: data.length, sha256
    }
    const record: PreviewAssetRecord = {
      asset,
      read: async () => {
        const current = await read()
        if (current.length !== asset.size || artifactHash(current) !== asset.sha256) throw new Error('ARTIFACT_CHANGED')
        return current
      }
    }
    this.records.set(asset.id, record)
    this.paths.set(path, record)
    this.bytes += data.length
    return record
  }

  get assets() { return [...this.records.values()].map(record => record.asset) }
  get retainedBytes() { return this.retained }

  fingerprint() {
    return artifactHash(this.assets.map(asset => [asset.path, asset.sha256]).sort(([left], [right]) => left!.localeCompare(right!)).map(row => row.join(':')).join('\n'))
  }
}
