import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type ArtifactManifest = {
  deliveryId: string
  files: Array<{ path: string; bytes: number; sha256: string }>
}

export type ArtifactPreview = {
  path: string
  kind: 'new' | 'modified' | 'unchanged'
  bytes: number
  beforeSha256: string | null
  afterSha256: string
}

export class ArtifactApplyError extends Error {
  constructor(
    readonly code:
      | 'artifact_path_invalid'
      | 'artifact_content_invalid'
      | 'artifact_baseline_changed'
      | 'artifact_symlink_rejected',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ArtifactApplyError'
  }
}

export class ArtifactReviewer {
  private readonly files: Array<{ path: string; absolute: string; bytes: number; sha256: string; content: Buffer }>
  private baselines: Map<string, string | null> | null = null

  constructor(
    private readonly workspaceRoot: string,
    manifest: ArtifactManifest,
    content: Map<string, Buffer>
  ) {
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
    if (total > 100 * 1024 * 1024) throw new ArtifactApplyError('artifact_content_invalid', 'Artifact exceeds 100 MB')
    const seen = new Set<string>()
    this.files = manifest.files.map((file) => {
      const path = validateRelativePath(file.path)
      if (seen.has(path)) throw new ArtifactApplyError('artifact_path_invalid', `Duplicate artifact path: ${path}`)
      seen.add(path)
      const value = content.get(file.path) ?? content.get(path)
      if (!value || value.byteLength !== file.bytes || sha256(value) !== file.sha256.toLowerCase()) {
        throw new ArtifactApplyError('artifact_content_invalid', `Artifact content does not match manifest: ${path}`)
      }
      const absolute = resolve(workspaceRoot, ...path.split('/'))
      if (!isWithin(workspaceRoot, absolute)) throw new ArtifactApplyError('artifact_path_invalid', `Artifact escapes workspace: ${path}`)
      return { ...file, path, absolute, sha256: file.sha256.toLowerCase(), content: Buffer.from(value) }
    })
  }

  async preview(): Promise<ArtifactPreview[]> {
    await rejectSymlinkParents(this.workspaceRoot, this.files.map((file) => file.absolute))
    const baselines = new Map<string, string | null>()
    const result: ArtifactPreview[] = []
    for (const file of this.files) {
      const existing = await readRegularFile(file.absolute)
      const beforeSha256 = existing ? sha256(existing) : null
      baselines.set(file.path, beforeSha256)
      result.push({
        path: file.path,
        kind: beforeSha256 === null ? 'new' : beforeSha256 === file.sha256 ? 'unchanged' : 'modified',
        bytes: file.bytes,
        beforeSha256,
        afterSha256: file.sha256
      })
    }
    this.baselines = baselines
    return result
  }

  async apply(): Promise<void> {
    if (!this.baselines) await this.preview()
    await rejectSymlinkParents(this.workspaceRoot, this.files.map((file) => file.absolute))
    for (const file of this.files) {
      const current = await readRegularFile(file.absolute)
      const currentHash = current ? sha256(current) : null
      if (currentHash !== this.baselines?.get(file.path)) {
        throw new ArtifactApplyError('artifact_baseline_changed', `Workspace changed after preview: ${file.path}`)
      }
    }
    for (const file of this.files) {
      await mkdir(dirname(file.absolute), { recursive: true })
      const temporary = `${file.absolute}.${process.pid}.${randomUUID()}.delivery.tmp`
      await writeFile(temporary, file.content, { flag: 'wx' })
      await rename(temporary, file.absolute)
    }
  }
}

function validateRelativePath(input: string): string {
  const normalized = input.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    !normalized || normalized !== input || isAbsolute(input) || normalized.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    normalized.length > 240 || segments.some(isWindowsReservedName) ||
    ['.git', '.kun', '.kun-design'].includes(segments[0].toLowerCase())
  ) {
    throw new ArtifactApplyError('artifact_path_invalid', `Unsafe artifact path: ${input}`)
  }
  return normalized
}

function isWindowsReservedName(segment: string): boolean {
  const stem = segment.split('.')[0].replace(/[ .]+$/g, '').toUpperCase()
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem) ||
    /[<>:"|?*]/.test(segment) || [...segment].some((character) => character.charCodeAt(0) < 32)
}

function isWithin(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target))
  return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)
}

async function rejectSymlinkParents(root: string, paths: string[]): Promise<void> {
  for (const target of paths) {
    let current = dirname(target)
    while (isWithin(root, current)) {
      const stats = await lstat(current).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (stats?.isSymbolicLink()) throw new ArtifactApplyError('artifact_symlink_rejected', `Symlink parent rejected: ${current}`)
      if (resolve(current) === resolve(root)) break
      current = dirname(current)
    }
    const stats = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (stats?.isSymbolicLink()) throw new ArtifactApplyError('artifact_symlink_rejected', `Symlink target rejected: ${target}`)
  }
}

async function readRegularFile(path: string): Promise<Buffer | null> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!stats) return null
  if (!stats.isFile()) throw new ArtifactApplyError('artifact_path_invalid', `Artifact target is not a regular file: ${path}`)
  return readFile(path)
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
