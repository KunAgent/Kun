import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import {
  checkpointDir,
  isValidWithinBase,
  resolveCheckpointTarget,
  type GitCheckpointMetadata
} from './git-checkpoint-foundation'

export type CheckpointFileContent =
  | { kind: 'absent' }
  | { kind: 'content'; bytes: Buffer; executable: boolean }
  | { kind: 'unavailable'; reason: 'not_in_snapshot' | 'gitignored' | 'unreadable'; detail?: string }

/**
 * Read-only view of a checkpoint's working tree. Tracked content is rebuilt
 * in a throwaway index (HEAD + staged patch + unstaged patch) so the user's
 * real index and working tree are never touched; untracked content comes
 * from the checkpoint's bounded copy.
 */
export type CheckpointFileReader = {
  readonly repositoryRoot: string
  readonly metadata: GitCheckpointMetadata
  /** Repository-relative `/` paths, as stored in the checkpoint. */
  readonly untrackedPaths: ReadonlySet<string>
  readMany: (relativePaths: string[]) => Promise<Map<string, CheckpointFileContent>>
  /** Tree object of the checkpoint's tracked files (written to the object store). */
  writeTree: () => Promise<string>
  dispose: () => Promise<void>
}

const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 256 * 1_024 * 1_024

type GitExecError = Error & { code?: number | string; stderr?: Buffer | string }

/** Binary-safe git runner with a C locale and literal pathspecs. */
export function execGitBuffer(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  input?: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd,
      encoding: 'buffer',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_LITERAL_PATHSPECS: '1', ...env }
    }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as GitExecError
        const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : ''
        if (detail) failure.message = `${failure.message.split('\n')[0]}: ${detail}`
        reject(failure)
        return
      }
      resolve(stdout)
    })
    // Most git commands exit without reading stdin, so a pending write can hit
    // a closed pipe (EPIPE). The exit status above is the source of truth;
    // an unhandled stream error would instead crash the main process.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function splitNulBuffer(stdout: Buffer): string[] {
  return stdout.toString('utf8').split('\0').filter((entry) => entry.length > 0)
}

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0
}

/** Current on-disk state of a file: `null` when absent. Throws for non-files. */
export async function readCurrentFile(
  absolutePath: string
): Promise<{ bytes: Buffer; sha256: string; executable: boolean } | null> {
  let info
  try {
    info = await lstat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (info.isSymbolicLink()) throw new Error('is a symbolic link')
  if (!info.isFile()) throw new Error('is not a regular file')
  const bytes = await readFile(absolutePath)
  return { bytes, sha256: sha256Hex(bytes), executable: isExecutableMode(info.mode) }
}

async function applyCachedPatch(repositoryRoot: string, path: string, env: Record<string, string>): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return
  await execGitBuffer(repositoryRoot, ['apply', '--cached', '--binary', path], env)
}

export async function openCheckpointFileReader(params: {
  checkpointsRoot: string
  metadata: GitCheckpointMetadata
}): Promise<CheckpointFileReader> {
  const { checkpointsRoot, metadata } = params
  const repositoryRoot = metadata.repositoryRoot
  const dir = checkpointDir(checkpointsRoot, metadata.checkpointId)
  const scratch = await mkdtemp(join(tmpdir(), 'kun-turn-undo-'))
  const env = { GIT_INDEX_FILE: join(scratch, 'index') }
  const untrackedPaths = new Set(metadata.untrackedFiles)
  const skippedPaths = new Set(metadata.skippedUntracked ?? [])
  let buildError: string | null = null
  try {
    if (metadata.head) {
      const target = await resolveCheckpointTarget(repositoryRoot, checkpointsRoot, metadata)
      await execGitBuffer(repositoryRoot, ['read-tree', target], env)
    } else {
      await execGitBuffer(repositoryRoot, ['read-tree', '--empty'], env)
    }
    await applyCachedPatch(repositoryRoot, join(dir, 'staged.patch'), env)
    await applyCachedPatch(repositoryRoot, join(dir, 'unstaged.patch'), env)
  } catch (error) {
    buildError = error instanceof Error ? error.message : String(error)
  }

  let untrackedReal: string | null = null
  const untrackedBase = async (): Promise<string> => {
    if (untrackedReal) return untrackedReal
    const lexical = join(dir, 'untracked')
    untrackedReal = await realpath(lexical).catch(() => normalize(lexical))
    return untrackedReal
  }

  const readTracked = async (
    relativePaths: string[]
  ): Promise<Map<string, { mode: string; blob: string }>> => {
    const entries = new Map<string, { mode: string; blob: string }>()
    if (relativePaths.length === 0) return entries
    const stdout = await execGitBuffer(repositoryRoot, ['ls-files', '-s', '-z', '--', ...relativePaths], env)
    for (const record of splitNulBuffer(stdout)) {
      const tab = record.indexOf('\t')
      if (tab < 0) continue
      const [mode, blob] = record.slice(0, tab).split(' ')
      entries.set(record.slice(tab + 1), { mode: mode ?? '', blob: blob ?? '' })
    }
    return entries
  }

  const readIgnored = async (relativePaths: string[]): Promise<Set<string>> => {
    if (relativePaths.length === 0) return new Set()
    try {
      const stdout = await execGitBuffer(
        repositoryRoot,
        ['check-ignore', '--no-index', '-z', '--stdin'],
        // check-ignore rejects pathspec magic; stdin paths are taken literally.
        { GIT_LITERAL_PATHSPECS: '0' },
        `${relativePaths.join('\0')}\0`
      )
      return new Set(splitNulBuffer(stdout))
    } catch (error) {
      // Exit status 1 means "none of the paths is ignored".
      if ((error as GitExecError).code === 1) return new Set()
      throw error
    }
  }

  const readMany = async (relativePaths: string[]): Promise<Map<string, CheckpointFileContent>> => {
    const result = new Map<string, CheckpointFileContent>()
    const unique = [...new Set(relativePaths)]
    if (buildError) {
      for (const path of unique) {
        result.set(path, { kind: 'unavailable', reason: 'unreadable', detail: buildError })
      }
      return result
    }
    const tracked = await readTracked(unique)
    const unresolved: string[] = []
    for (const path of unique) {
      const entry = tracked.get(path)
      if (entry) {
        if (entry.mode !== '100644' && entry.mode !== '100755') {
          result.set(path, { kind: 'unavailable', reason: 'unreadable', detail: `unsupported Git entry mode ${entry.mode}` })
          continue
        }
        try {
          // `--filters` applies the repository's smudge/eol conversion, so the
          // bytes match what the working tree held at checkpoint time.
          const bytes = await execGitBuffer(repositoryRoot, ['cat-file', '--filters', `--path=${path}`, entry.blob])
          result.set(path, { kind: 'content', bytes, executable: entry.mode === '100755' })
        } catch (error) {
          result.set(path, {
            kind: 'unavailable',
            reason: 'unreadable',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
        continue
      }
      if (untrackedPaths.has(path)) {
        const base = await untrackedBase()
        if (!isValidWithinBase(path, base)) {
          result.set(path, { kind: 'unavailable', reason: 'unreadable', detail: 'snapshot path escapes the checkpoint' })
          continue
        }
        const copy = normalize(join(base, path))
        try {
          const [bytes, info] = await Promise.all([readFile(copy), stat(copy)])
          result.set(path, { kind: 'content', bytes, executable: isExecutableMode(info.mode) })
        } catch (error) {
          result.set(path, {
            kind: 'unavailable',
            reason: 'unreadable',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
        continue
      }
      if (skippedPaths.has(path)) {
        result.set(path, { kind: 'unavailable', reason: 'not_in_snapshot' })
        continue
      }
      unresolved.push(path)
    }
    const ignored = await readIgnored(unresolved)
    for (const path of unresolved) {
      result.set(path, ignored.has(path)
        ? { kind: 'unavailable', reason: 'gitignored' }
        : { kind: 'absent' })
    }
    return result
  }

  const writeTree = async (): Promise<string> => {
    if (buildError) throw new Error(buildError)
    return (await execGitBuffer(repositoryRoot, ['write-tree'], env)).toString('utf8').trim()
  }

  return {
    repositoryRoot,
    metadata,
    untrackedPaths,
    readMany,
    writeTree,
    dispose: () => rm(scratch, { recursive: true, force: true })
  }
}
