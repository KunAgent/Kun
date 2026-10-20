import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitCheckpoint } from './git-checkpoint-service'
import {
  getTurnUndoStatus,
  preflightTurnUndo,
  reapplyTurnFiles,
  undoTurnFiles
} from './git-turn-undo-service'

let sandbox = ''
let repoRoot = ''
let dataDir = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'pipe' }).toString('utf8')
}

function sha(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function checkpoint(threadId = 'thread-1'): Promise<string> {
  const result = await createGitCheckpoint({ dataDir, workspaceRoot: repoRoot, threadId })
  if (!result.ok) throw new Error(result.message)
  return result.checkpointId
}

/** Simulates a Kun file tool write and returns the fileState it would report. */
async function agentWrite(relativePath: string, content: string): Promise<{ path: string; afterSha256: string }> {
  const path = join(repoRoot, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return { path, afterSha256: sha(content) }
}

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'kun-turn-undo-test-')))
  repoRoot = join(sandbox, 'repo')
  dataDir = join(sandbox, 'data')
  execFileSync('git', ['init', '-b', 'main', repoRoot], { stdio: 'pipe' })
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(repoRoot, 'tracked.txt'), 'base\n')
  await writeFile(join(repoRoot, 'staged.txt'), 'staged base\n')
  await writeFile(join(repoRoot, 'script.sh'), 'echo base\n')
  await chmod(join(repoRoot, 'script.sh'), 0o755)
  await writeFile(join(repoRoot, '.gitignore'), 'ignored.log\n')
  git('add', '.')
  git('commit', '-m', 'init')
})

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true })
  sandbox = ''
})

describe('preflightTurnUndo', () => {
  it('sorts files into safe, unsafe and ignored without writing anything', async () => {
    // Pre-turn state: user edits (unstaged + staged) and an untracked note.
    await writeFile(join(repoRoot, 'tracked.txt'), 'user edit\n')
    await writeFile(join(repoRoot, 'staged.txt'), 'staged change\n')
    git('add', 'staged.txt')
    await writeFile(join(repoRoot, 'notes.md'), 'untracked before\n')
    await writeFile(join(repoRoot, 'ignored.log'), 'log before\n')
    const checkpointId = await checkpoint()

    const files = [
      await agentWrite('tracked.txt', 'agent edit\n'),
      await agentWrite('staged.txt', 'agent staged\n'),
      await agentWrite('notes.md', 'agent notes\n'),
      await agentWrite('src/new.ts', 'export {}\n'),
      await agentWrite('touched-back.txt', 'temp\n'),
      await agentWrite('ignored.log', 'agent log\n')
    ]
    await rm(join(repoRoot, 'touched-back.txt'))
    // The user edits one of the turn's files after the turn ends.
    await writeFile(join(repoRoot, 'notes.md'), 'user after turn\n')

    const result = await preflightTurnUndo({
      dataDir,
      request: {
        checkpointId,
        expectedThreadId: 'thread-1',
        files: [...files, { path: join(repoRoot, 'unknown.txt'), afterSha256: null }]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { preflight } = result
    expect(preflight.safe).toEqual([
      { path: 'src/new.ts', action: 'delete' },
      { path: 'staged.txt', action: 'restore' },
      { path: 'tracked.txt', action: 'restore' }
    ])
    expect(preflight.unsafe).toEqual([
      { path: 'ignored.log', reason: 'gitignored' },
      { path: 'notes.md', reason: 'modified_after_turn' }
    ])
    expect(preflight.ignored).toEqual([
      { path: 'touched-back.txt', reason: 'no_net_change' },
      { path: 'unknown.txt', reason: 'end_state_unknown' }
    ])
    expect(preflight.canUndo).toBe(false)
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('agent edit\n')
  })

  it('ignores files without an end state and reports missing checkpoints and outside paths', async () => {
    const checkpointId = await checkpoint()
    await agentWrite('tracked.txt', 'agent\n')
    const outside = join(sandbox, 'outside.txt')
    await writeFile(outside, 'x')
    const result = await preflightTurnUndo({
      dataDir,
      request: {
        checkpointId,
        files: [
          { path: join(repoRoot, 'tracked.txt'), afterSha256: null },
          { path: outside, afterSha256: sha('x') }
        ]
      }
    })
    expect(result.ok && result.preflight.unsafe).toEqual([{ path: outside, reason: 'outside_workspace' }])
    expect(result.ok && result.preflight.ignored).toEqual([{ path: 'tracked.txt', reason: 'end_state_unknown' }])
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('agent\n')

    const missing = await preflightTurnUndo({
      dataDir,
      request: {
        checkpointId: 'gcp_missing',
        expectedWorkspaceRoot: repoRoot,
        files: [{ path: join(repoRoot, 'tracked.txt'), afterSha256: sha('agent\n') }]
      }
    })
    expect(missing.ok && missing.preflight.unsafe).toEqual([{ path: 'tracked.txt', reason: 'checkpoint_missing' }])
  })

  it('lists files changed outside the file tools when the turn ran shell commands', async () => {
    const checkpointId = await checkpoint()
    const tool = await agentWrite('tracked.txt', 'agent\n')
    await writeFile(join(repoRoot, 'staged.txt'), 'shell rewrite\n')
    await writeFile(join(repoRoot, 'generated.json'), '{}\n')
    const result = await preflightTurnUndo({
      dataDir,
      request: { checkpointId, files: [tool], shellCommandsRan: true }
    })
    expect(result.ok && result.preflight.ignored).toEqual([
      { path: 'generated.json', reason: 'shell_changed' },
      { path: 'staged.txt', reason: 'shell_changed' }
    ])
    expect(result.ok && result.preflight.canUndo).toBe(true)
  })

  it('bounds shell attribution by the next turn checkpoint', async () => {
    const checkpointId = await checkpoint()
    const tool = await agentWrite('tracked.txt', 'agent\n')
    await writeFile(join(repoRoot, 'during-turn.txt'), 'shell\n')
    const nextCheckpointId = await checkpoint()
    await writeFile(join(repoRoot, 'later-turn.txt'), 'later\n')
    const result = await preflightTurnUndo({
      dataDir,
      request: { checkpointId, files: [tool], shellCommandsRan: true, windowEndCheckpointId: nextCheckpointId }
    })
    expect(result.ok && result.preflight.ignored).toEqual([{ path: 'during-turn.txt', reason: 'shell_changed' }])
  })

  it('rejects a checkpoint from another thread', async () => {
    const checkpointId = await checkpoint('thread-1')
    const result = await preflightTurnUndo({
      dataDir,
      request: { checkpointId, expectedThreadId: 'thread-2', files: [] }
    })
    expect(result.ok).toBe(false)
  })
})

describe('undoTurnFiles and reapplyTurnFiles', () => {
  it('restores only the turn files, keeps other edits, and reapplies the turn', async () => {
    await writeFile(join(repoRoot, 'tracked.txt'), 'user edit before turn\n')
    const checkpointId = await checkpoint()
    const files = [
      await agentWrite('tracked.txt', 'agent edit\n'),
      await agentWrite('src/new.ts', 'export const a = 1\n'),
      await agentWrite('script.sh', 'echo agent\n')
    ]
    await chmod(join(repoRoot, 'script.sh'), 0o644)
    // An unrelated uncommitted edit must survive undo.
    await writeFile(join(repoRoot, 'staged.txt'), 'unrelated user edit\n')

    const undone = await undoTurnFiles({ dataDir, request: { checkpointId, files } })
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.restored.sort()).toEqual(['script.sh', 'tracked.txt'])
    expect(undone.deleted).toEqual(['src/new.ts'])
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('user edit before turn\n')
    expect(await readFile(join(repoRoot, 'script.sh'), 'utf8')).toBe('echo base\n')
    expect((await stat(join(repoRoot, 'script.sh'))).mode & 0o111).not.toBe(0)
    await expect(stat(join(repoRoot, 'src/new.ts'))).rejects.toThrow()
    expect(await readFile(join(repoRoot, 'staged.txt'), 'utf8')).toBe('unrelated user edit\n')

    expect(await getTurnUndoStatus({ dataDir, request: { checkpointId } })).toMatchObject({
      state: 'undone',
      undoId: undone.undoId,
      fileCount: 3
    })

    const reapplied = await reapplyTurnFiles({ dataDir, request: { checkpointId, undoId: undone.undoId } })
    expect(reapplied.ok).toBe(true)
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('agent edit\n')
    expect(await readFile(join(repoRoot, 'src/new.ts'), 'utf8')).toBe('export const a = 1\n')
    expect((await stat(join(repoRoot, 'script.sh'))).mode & 0o111).toBe(0)
    expect(await getTurnUndoStatus({ dataDir, request: { checkpointId } })).toEqual({ state: 'none' })
  })

  it('writes nothing when any file is unsafe', async () => {
    const checkpointId = await checkpoint()
    const safe = await agentWrite('tracked.txt', 'agent\n')
    const edited = await agentWrite('staged.txt', 'agent staged\n')
    await writeFile(join(repoRoot, 'staged.txt'), 'user changed it after\n')

    const result = await undoTurnFiles({ dataDir, request: { checkpointId, files: [safe, edited] } })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('unsafe')
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('agent\n')
    expect(await readFile(join(repoRoot, 'staged.txt'), 'utf8')).toBe('user changed it after\n')
  })

  it('refuses reapply when a file changed after the undo', async () => {
    const checkpointId = await checkpoint()
    const files = [await agentWrite('tracked.txt', 'agent\n'), await agentWrite('other.txt', 'new\n')]
    const undone = await undoTurnFiles({ dataDir, request: { checkpointId, files } })
    if (!undone.ok) throw new Error(undone.message)
    await writeFile(join(repoRoot, 'tracked.txt'), 'user after undo\n')

    const result = await reapplyTurnFiles({ dataDir, request: { checkpointId, undoId: undone.undoId } })
    expect(result).toMatchObject({ ok: false, reason: 'unsafe', conflicts: [{ path: 'tracked.txt', reason: 'modified_after_undo' }] })
    await expect(stat(join(repoRoot, 'other.txt'))).rejects.toThrow()
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('user after undo\n')
  })

  it('refuses while a task in the same repository is running', async () => {
    const checkpointId = await checkpoint()
    const files = [await agentWrite('tracked.txt', 'agent\n')]
    const result = await undoTurnFiles({
      dataDir,
      request: { checkpointId, files },
      runtimeRequest: async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ threads: [{ status: 'running', workspace: repoRoot }] })
      })
    })
    expect(result).toMatchObject({ ok: false, reason: 'busy' })
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('agent\n')
  })

  it('restores working-tree bytes when Git converts line endings', async () => {
    git('config', 'core.autocrlf', 'true')
    await writeFile(join(repoRoot, 'crlf.txt'), 'one\r\ntwo\r\n')
    git('add', 'crlf.txt')
    git('commit', '-m', 'crlf')
    const checkpointId = await checkpoint()
    const files = [await agentWrite('crlf.txt', 'agent\r\n')]
    const result = await undoTurnFiles({ dataDir, request: { checkpointId, files } })
    expect(result.ok).toBe(true)
    expect(await readFile(join(repoRoot, 'crlf.txt'), 'utf8')).toBe('one\r\ntwo\r\n')
  })

  it('works in a repository without commits', async () => {
    const emptyRepo = join(sandbox, 'empty')
    execFileSync('git', ['init', '-b', 'main', emptyRepo], { stdio: 'pipe' })
    await writeFile(join(emptyRepo, 'draft.txt'), 'draft\n')
    const created = await createGitCheckpoint({ dataDir, workspaceRoot: emptyRepo, threadId: 'thread-1' })
    if (!created.ok) throw new Error(created.message)
    await writeFile(join(emptyRepo, 'draft.txt'), 'agent\n')
    const result = await undoTurnFiles({
      dataDir,
      request: { checkpointId: created.checkpointId, files: [{ path: join(emptyRepo, 'draft.txt'), afterSha256: sha('agent\n') }] }
    })
    expect(result.ok).toBe(true)
    expect(await readFile(join(emptyRepo, 'draft.txt'), 'utf8')).toBe('draft\n')
  })
})
