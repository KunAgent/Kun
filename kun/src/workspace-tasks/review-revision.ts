import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ReviewRevision } from '../contracts/review-revision.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { workspaceGit } from './workspace-git.js'

export type ReviewRevisionLimits = {
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  /** Test seam for deterministic write-during-read coverage. */
  onBeforeFileRead?: (path: string) => Promise<void>
}

type ScanLimits = Required<Pick<ReviewRevisionLimits, 'maxFiles' | 'maxFileBytes' | 'maxTotalBytes'>> &
  Pick<ReviewRevisionLimits, 'onBeforeFileRead'>

type Scan = {
  headRevision?: string
  contentHash?: string
  fileCount: number
  reason?: NonNullable<ReviewRevision['reason']>
}

const DEFAULT_MAX_FILES = 2_048
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024

class IncompleteScan extends Error {
  constructor(readonly reason: NonNullable<ReviewRevision['reason']>) { super(reason) }
}

async function fileSignature(
  path: string, remaining: number, perFile: number,
  onBeforeFileRead?: (path: string) => Promise<void>
): Promise<{ hash: string; bytes: number }> {
  const before = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw new IncompleteScan('unsupported_entry')
  })
  if (!before) return { hash: 'missing', bytes: 0 }
  if (before.isSymbolicLink()) {
    const target = await readlink(path)
    return { hash: createHash('sha256').update(`symlink\0${target}`).digest('hex'), bytes: 0 }
  }
  if (!before.isFile()) throw new IncompleteScan('unsupported_entry')
  if (before.size > perFile) throw new IncompleteScan('file_too_large')
  if (before.size > remaining) throw new IncompleteScan('total_bytes_exceeded')
  await onBeforeFileRead?.(path)
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > perFile) throw new IncompleteScan('file_too_large')
      if (bytes > remaining) throw new IncompleteScan('total_bytes_exceeded')
      hash.update(buffer)
    }
  } catch (error) {
    if (error instanceof IncompleteScan) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new IncompleteScan('concurrent_change')
    throw new IncompleteScan('unsupported_entry')
  }
  const after = await lstat(path).catch(() => null)
  if (!after || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || bytes !== before.size) {
    throw new IncompleteScan('concurrent_change')
  }
  return { hash: hash.digest('hex'), bytes }
}

async function scan(workspacePath: string, limits: ScanLimits): Promise<Scan> {
  let headRevision: string | undefined
  let fileCount = 0
  try {
    const root = (await workspaceGit(workspacePath, ['rev-parse', '--show-toplevel'], undefined, 20_000)).trim()
    headRevision = (await workspaceGit(root, ['rev-parse', 'HEAD'], undefined, 20_000)).trim()
    if (!/^[a-f0-9]{40,64}$/.test(headRevision)) throw new IncompleteScan('git_unavailable')
    const [status, staged] = await Promise.all([
      workspaceGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], undefined, 20_000),
      workspaceGit(root, ['diff', '--cached', '--raw', '--no-renames', '-z', 'HEAD', '--'], undefined, 20_000)
    ])
    if (Buffer.byteLength(status) > MAX_GIT_OUTPUT_BYTES || Buffer.byteLength(staged) > MAX_GIT_OUTPUT_BYTES) {
      throw new IncompleteScan('too_many_files')
    }
    const entries = status.split('\0').filter(Boolean)
    const paths = [...new Set(entries.map((entry) => entry.slice(3)))].sort()
    fileCount = paths.length
    if (fileCount > limits.maxFiles) throw new IncompleteScan('too_many_files')
    const fingerprint = createHash('sha256')
    fingerprint.update('kun-review-revision-v1\0')
    fingerprint.update(headRevision).update('\0').update(staged).update('\0').update(status).update('\0')
    let remaining = limits.maxTotalBytes
    for (const path of paths) {
      if (!path || path.startsWith('/') || path.split('/').includes('..')) {
        throw new IncompleteScan('unsupported_entry')
      }
      const result = await fileSignature(
        resolve(root, path), remaining, limits.maxFileBytes, limits.onBeforeFileRead
      )
      remaining -= result.bytes
      fingerprint.update(path).update('\0').update(result.hash).update('\0')
    }
    return { headRevision, contentHash: fingerprint.digest('hex'), fileCount }
  } catch (error) {
    return {
      ...(headRevision ? { headRevision } : {}), fileCount,
      reason: error instanceof IncompleteScan ? error.reason : 'git_unavailable'
    }
  }
}

/** Two bounded reads turn concurrent edits into unknown instead of a false match. */
export async function captureReviewRevision(
  workspaceId: string,
  workspacePath: string,
  options: ReviewRevisionLimits = {},
  targetKind: ReviewRevision['target']['kind'] = 'task-workspace'
): Promise<ReviewRevision> {
  const limits = {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    onBeforeFileRead: options.onBeforeFileRead
  }
  const first = await scan(workspacePath, limits)
  const second = first.reason ? first : await scan(workspacePath, limits)
  const reason = first.reason ?? second.reason ??
    (first.contentHash !== second.contentHash ? 'concurrent_change' : undefined)
  return {
    version: 1,
    target: { kind: targetKind, workspaceId },
    ...(second.headRevision ? { headRevision: second.headRevision } : {}),
    ...(reason ? {} : { contentHash: second.contentHash }),
    completeness: reason ? 'incomplete' : 'complete',
    ...(reason ? { reason } : {}),
    fileCount: second.fileCount,
    capturedAt: new Date().toISOString()
  }
}

export type IntegrateReviewRevisions = {
  sourceRevision: ReviewRevision
  targetRevision: ReviewRevision
  targetBranchRevision?: string
  previewToken?: string
}

/** Bind an integration decision to both checkouts and the target branch ref. */
export async function captureIntegrateReviewRevisions(
  record: TaskWorkspaceRecord
): Promise<IntegrateReviewRevisions> {
  const [sourceRevision, targetRevision, targetBranchRevision] = await Promise.all([
    captureReviewRevision(record.workspaceId, record.sourceRoot, {}, 'source-checkout'),
    captureReviewRevision(record.workspaceId, record.path),
    record.targetBranch && record.repositoryRoot
      ? workspaceGit(record.repositoryRoot, ['rev-parse', `${record.targetBranch}^{commit}`], undefined, 20_000)
          .then((text) => text.trim()).catch(() => undefined)
      : Promise.resolve(undefined)
  ])
  const validRef = !record.targetBranch || Boolean(targetBranchRevision && /^[a-f0-9]{40,64}$/.test(targetBranchRevision))
  const complete = sourceRevision.completeness === 'complete' &&
    targetRevision.completeness === 'complete' && validRef
  const previewToken = complete
    ? createHash('sha256').update(JSON.stringify([
        'kun-integrate-preview-v1', record.workspaceId, record.baseRevision,
        record.branch, record.targetBranch, targetBranchRevision,
        sourceRevision.contentHash, targetRevision.contentHash
      ])).digest('hex')
    : undefined
  return {
    sourceRevision, targetRevision,
    ...(targetBranchRevision ? { targetBranchRevision } : {}),
    ...(previewToken ? { previewToken } : {})
  }
}
