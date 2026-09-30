import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import {
  DIFF_TEXT_LIMIT_BYTES,
  taskWorkspaceDiffFile,
  taskWorkspaceDiffList
} from './task-workspace-diff.js'

const PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 111..222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old',
  '+new',
  '+more',
  'diff --git a/big.ts b/big.ts',
  'index 111..222 100644',
  '--- a/big.ts',
  '+++ b/big.ts',
  '@@ -1 +1,2 @@',
  ' line',
  '+line',
  ''
].join('\n')

const artifacts = { get: async (): Promise<string | null> => PATCH }

function record(dir: string): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_testdiff1',
    ownerThreadId: 'thread-1',
    isolation: 'worktree',
    sourceRoot: dir,
    path: dir,
    baseRevision: 'abc123',
    headRevision: 'def456',
    patchArtifactId: 'art_1',
    startFrom: { kind: 'current-head' },
    state: 'captured',
    setup: { status: 'succeeded' },
    changedFiles: ['a.ts', 'big.ts'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
}

const dirs: string[] = []
async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tws-diff-'))
  dirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('task-workspace diff assembly', () => {
  it('lists per-file stats with head revision', async () => {
    const dir = await workspace()
    const list = await taskWorkspaceDiffList(record(dir), artifacts)
    expect(list.headRevision).toBe('def456')
    expect(list.files.map((f) => [f.path, f.status, f.insertions, f.deletions])).toEqual([
      ['a.ts', 'modified', 2, 1],
      ['big.ts', 'modified', 1, 0]
    ])
  })

  it('returns patch and worktree text for a small file', async () => {
    const dir = await workspace()
    await writeFile(join(dir, 'a.ts'), 'keep\nnew\nmore\n')
    const file = await taskWorkspaceDiffFile(record(dir), artifacts, 'a.ts')
    expect(file?.patch).toContain('diff --git a/a.ts')
    expect(file?.newText).toBe('keep\nnew\nmore\n')
    expect(file?.tooLarge).toBe(false)
  })

  it('returns stats only when the worktree file exceeds 1 MiB', async () => {
    const dir = await workspace()
    await writeFile(join(dir, 'big.ts'), 'x'.repeat(DIFF_TEXT_LIMIT_BYTES + 1))
    const file = await taskWorkspaceDiffFile(record(dir), artifacts, 'big.ts')
    expect(file?.tooLarge).toBe(true)
    expect(file?.patch).toBeUndefined()
    expect(file?.newText).toBeUndefined()
    expect(file?.insertions).toBe(1)
  })

  it('returns stats only when the captured patch exceeds 1 MiB', async () => {
    const dir = await workspace()
    const huge = `${'diff --git a/h.ts b/h.ts\n--- a/h.ts\n+++ b/h.ts\n@@ -1 +1 @@\n- a\n'}${'+ x\n'.repeat(DIFF_TEXT_LIMIT_BYTES / 4)}`
    const big = { get: async (): Promise<string | null> => huge }
    const file = await taskWorkspaceDiffFile(record(dir), big, 'h.ts')
    expect(file?.tooLarge).toBe(true)
    expect(file?.patch).toBeUndefined()
  })

  it('returns undefined for a path outside the captured diff', async () => {
    const dir = await workspace()
    expect(await taskWorkspaceDiffFile(record(dir), artifacts, 'none.ts')).toBeUndefined()
  })
})
