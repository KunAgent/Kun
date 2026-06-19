import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runGit, resolveGitCwd } from './git-service'
import type {
  GitCheckpointCreateResult,
  GitCheckpointRestoreResult
} from '../../shared/git-checkpoint'

type GitCheckpointMetadata = {
  checkpointId: string
  threadId: string
  repositoryRoot: string
  head: string
  checkpointRef: string
  currentBranch: string | null
  createdAt: string
  untrackedFiles: string[]
}

function checkpointFailure(error: unknown): Extract<GitCheckpointCreateResult, { ok: false }> {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

function restoreFailure(error: unknown): Extract<GitCheckpointRestoreResult, { ok: false }> {
  const failure = checkpointFailure(error)
  return { ...failure, reason: failure.reason }
}

function checkpointDir(dataDir: string, checkpointId: string): string {
  return join(resolve(dataDir), 'git-checkpoints', checkpointId)
}

function checkpointRef(checkpointId: string): string {
  return `refs/kun/checkpoints/${checkpointId.replace(/[^A-Za-z0-9._-]/g, '_')}`
}

function metadataPath(dataDir: string, checkpointId: string): string {
  return join(checkpointDir(dataDir, checkpointId), 'metadata.json')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function splitNul(stdout: string): string[] {
  return stdout.split('\0').map((entry) => entry.trim()).filter(Boolean)
}

async function assertNoUnmerged(repositoryRoot: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ['diff', '--name-only', '--diff-filter=U'])
  const conflicted = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (conflicted.length > 0) {
    throw new Error(`Cannot create or restore a checkpoint while ${conflicted.length} files have merge conflicts.`)
  }
}

async function readMetadata(dataDir: string, checkpointId: string): Promise<GitCheckpointMetadata | null> {
  try {
    const raw = await readFile(metadataPath(dataDir, checkpointId), 'utf-8')
    return JSON.parse(raw) as GitCheckpointMetadata
  } catch {
    return null
  }
}

async function writePatch(repositoryRoot: string, args: string[], path: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, args, 30_000)
  await writeFile(path, stdout, 'utf-8')
}

async function applyPatchIfPresent(repositoryRoot: string, path: string, cached: boolean): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return
  await runGit(repositoryRoot, ['apply', '--binary', ...(cached ? ['--index'] : []), path], 30_000)
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string | null> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return null
  const { stdout } = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return stdout.trim()
}

export async function createGitCheckpoint(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId?: string
}): Promise<GitCheckpointCreateResult> {
  const workspaceRoot = params.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    if (!repositoryRoot) {
      return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    }
    await assertNoUnmerged(repositoryRoot)

    const checkpointId = params.checkpointId?.trim() || `gcp_${Date.now()}_${randomUUID()}`
    const dir = checkpointDir(params.dataDir, checkpointId)
    const ref = checkpointRef(checkpointId)
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'untracked'), { recursive: true })

    const head = (await runGit(repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(repositoryRoot, ['update-ref', ref, head])
    const currentBranchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentBranchRaw || null
    const untrackedFiles = splitNul(
      (await runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
    )

    await writePatch(repositoryRoot, ['diff', '--binary'], join(dir, 'unstaged.patch'))
    await writePatch(repositoryRoot, ['diff', '--cached', '--binary'], join(dir, 'staged.patch'))

    for (const relativePath of untrackedFiles) {
      const from = join(repositoryRoot, relativePath)
      const to = join(dir, 'untracked', relativePath)
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true, force: true, errorOnExist: false })
    }

    const metadata: GitCheckpointMetadata = {
      checkpointId,
      threadId: params.threadId,
      repositoryRoot,
      head,
      checkpointRef: ref,
      currentBranch,
      createdAt: new Date().toISOString(),
      untrackedFiles
    }
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
    return { ok: true, checkpointId, repositoryRoot, head, currentBranch }
  } catch (error) {
    const failure = checkpointFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}

export async function restoreGitCheckpoint(params: {
  dataDir: string
  checkpointId: string
}): Promise<GitCheckpointRestoreResult> {
  const checkpointId = params.checkpointId.trim()
  const metadata = await readMetadata(params.dataDir, checkpointId)
  if (!metadata) {
    return { ok: false, reason: 'not_found', message: `Git checkpoint not found: ${checkpointId}` }
  }
  try {
    const repositoryRoot = metadata.repositoryRoot
    await assertNoUnmerged(repositoryRoot)
    const targetRef = metadata.checkpointRef || metadata.head

    const rescue = await createGitCheckpoint({
      dataDir: params.dataDir,
      workspaceRoot: repositoryRoot,
      threadId: `${metadata.threadId}:rollback-rescue`
    })
    const rescueCheckpointId = rescue.ok ? rescue.checkpointId : null

    await runGit(repositoryRoot, ['reset', '--hard'], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)
    if (metadata.currentBranch) {
      await runGit(repositoryRoot, ['checkout', '-B', metadata.currentBranch, targetRef], 30_000)
    } else {
      await runGit(repositoryRoot, ['checkout', '--detach', targetRef], 30_000)
    }
    await runGit(repositoryRoot, ['reset', '--hard', targetRef], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)

    const dir = checkpointDir(params.dataDir, checkpointId)
    await applyPatchIfPresent(repositoryRoot, join(dir, 'staged.patch'), true)
    await applyPatchIfPresent(repositoryRoot, join(dir, 'unstaged.patch'), false)

    for (const relativePath of metadata.untrackedFiles) {
      const from = join(dir, 'untracked', relativePath)
      if (!(await fileExists(from))) continue
      const to = join(repositoryRoot, relativePath)
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true, force: true, errorOnExist: false })
    }

    return {
      ok: true,
      checkpointId,
      repositoryRoot,
      head: metadata.head,
      currentBranch: metadata.currentBranch,
      rescueCheckpointId
    }
  } catch (error) {
    const failure = restoreFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}
