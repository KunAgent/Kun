import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { reanchorWorkspaceComments } from './review-reanchor.js'
import { FileReviewStore } from './review-store.js'

const NOW = '2026-09-01T12:00:00.000Z'
const execFileAsync = promisify(execFile)
const dirs: string[] = []
let seq = 0

const nextId = (prefix: 'rvc' | 'rvq'): string =>
  `${prefix}_${(++seq).toString(36)}aaaaaaa`.slice(0, 40)

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-reanchor-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return result.stdout.trim()
}

async function makeRepo(): Promise<{ repo: string; baseRevision: string }> {
  const repo = await tempDir()
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'rv@example.test'])
  await git(repo, ['config', 'user.name', 'RV'])
  await writeFile(join(repo, 'a.ts'), ['l1', 'const x = 1', 'l3'].join('\n'))
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'base'])
  return { repo, baseRevision: await git(repo, ['rev-parse', 'HEAD']) }
}

const record = (path: string, baseRevision: string): TaskWorkspaceRecord => ({
  workspaceId: 'tws_reanchor01',
  ownerThreadId: 't1',
  isolation: 'worktree',
  sourceRoot: path,
  path,
  startFrom: { kind: 'current-head' },
  baseRevision,
  state: 'captured',
  setup: { status: 'skipped' },
  changedFiles: [],
  createdAt: NOW,
  updatedAt: NOW
})

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe('reanchorWorkspaceComments', () => {
  it('updates moved lines on both sides and leaves resolved comments alone', async () => {
    const dataDir = await tempDir()
    const { repo, baseRevision } = await makeRepo()
    const store = new FileReviewStore(dataDir, () => NOW, nextId)
    // New side: insert a line above the anchor so it moves 2 -> 3.
    await writeFile(join(repo, 'a.ts'), ['l1', 'l2', 'const x = 1', 'l4'].join('\n'))

    const moved = await store.create('tws_reanchor01', {
      path: 'a.ts', side: 'new', line: 2,
      anchor: { lineText: 'const x = 1', before: ['l1'], after: ['l3'] },
      body: 'n'
    })
    const oldSide = await store.create('tws_reanchor01', {
      path: 'a.ts', side: 'old', line: 2,
      anchor: { lineText: 'const x = 1', before: ['l1'], after: ['l3'] },
      body: 'n'
    })
    const resolved = await store.create('tws_reanchor01', {
      path: 'a.ts', side: 'new', line: 2,
      anchor: { lineText: 'const x = 1', before: [], after: [] },
      body: 'n'
    })
    await store.update('tws_reanchor01', resolved.commentId, { state: 'resolved' })

    await reanchorWorkspaceComments(store, record(repo, baseRevision))

    const comments = (await store.list('tws_reanchor01')).comments
    expect(comments.find((c) => c.commentId === moved.commentId)?.line).toBe(3)
    expect(comments.find((c) => c.commentId === moved.commentId)?.outdated).toBe(false)
    // Old side still points at baseRevision — line unchanged.
    expect(comments.find((c) => c.commentId === oldSide.commentId)?.line).toBe(2)
    expect(comments.find((c) => c.commentId === oldSide.commentId)?.outdated).toBe(false)
    // Resolved comments are skipped.
    expect(comments.find((c) => c.commentId === resolved.commentId)?.line).toBe(2)
  })

  it('marks comments outdated when the file disappears', async () => {
    const dataDir = await tempDir()
    const { repo, baseRevision } = await makeRepo()
    const store = new FileReviewStore(dataDir, () => NOW, nextId)
    const gone = await store.create('tws_reanchor01', {
      path: 'deleted.ts', side: 'new', line: 1,
      anchor: { lineText: 'x', before: [], after: [] },
      body: 'n'
    })
    await reanchorWorkspaceComments(store, record(repo, baseRevision))
    const comment = (await store.list('tws_reanchor01')).comments
      .find((c) => c.commentId === gone.commentId)
    expect(comment?.outdated).toBe(true)
  })
})
