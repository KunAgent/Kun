import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { observeRoomRepository, createRoomTaskWorktree, assertRoomApplyPreflight } from './task-workspace-service.js'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun rooms 中文 '))
  roots.push(root)
  const git = (...args: string[]) => exec('git', args, { cwd: root })
  await git('init', '-b', 'develop')
  await git('config', 'user.name', 'Kun Test')
  await git('config', 'user.email', 'kun-test@example.invalid')
  await writeFile(join(root, 'source.txt'), 'committed\n')
  await git('add', 'source.txt')
  await git('commit', '-m', 'test baseline')
  return root
}

describe('room workspace Git boundary', () => {
  it('creates a pinned worktree without copying or changing dirty source files', async () => {
    const root = await repository()
    await writeFile(join(root, 'source.txt'), 'user dirty\n')
    await writeFile(join(root, '.private-untracked'), 'do not copy\n')
    const before = await observeRoomRepository(root)
    expect(before.dirty).toBe(true)
    const tree = await createRoomTaskWorktree({ repository: before, taskId: 'task_one',
      destination: join(root, 'isolated task'), assertOwnership: async () => {} })
    expect(await readFile(join(tree.path, 'source.txt'), 'utf8')).toBe('committed\n')
    await expect(readFile(join(tree.path, '.private-untracked'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('user dirty\n')
    expect((await observeRoomRepository(root)).head).toBe(before.head)
  })
  it('never falls back to source when worktree creation fails', async () => {
    const root = await repository()
    const observed = await observeRoomRepository(root)
    await expect(createRoomTaskWorktree({ repository: observed, taskId: 'task_one', destination: root,
      assertOwnership: async () => {} })).rejects.toThrow()
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('committed\n')
  })
  it('rejects stale or dirty integration targets without changing files', async () => {
    const root = await repository()
    const expected = await observeRoomRepository(root)
    expect(() => assertRoomApplyPreflight(expected, expected)).not.toThrow()
    expect(() => assertRoomApplyPreflight({ ...expected, head: 'b'.repeat(40) }, expected)).toThrow('changed')
    await writeFile(join(root, 'source.txt'), 'user dirty\n')
    const dirty = await observeRoomRepository(root)
    expect(() => assertRoomApplyPreflight(dirty, expected)).toThrow('uncommitted')
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('user dirty\n')
  })
  it('requires current ownership before creating a branch or directory', async () => {
    const root = await repository()
    const observed = await observeRoomRepository(root)
    await expect(createRoomTaskWorktree({ repository: observed, taskId: 'task_denied',
      destination: join(root, 'denied'), assertOwnership: async () => { throw new Error('stale owner') }
    })).rejects.toThrow('stale owner')
    const refs = await exec('git', ['branch', '--list', 'codex/rooms/*'], { cwd: root })
    expect(refs.stdout.trim()).toBe('')
  })
})
