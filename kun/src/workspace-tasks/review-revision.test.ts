import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ReviewRevisionSchema, reviewRevisionValidity } from '../contracts/review-revision.js'
import { captureReviewRevision } from './review-revision.js'

const run = promisify(execFile)
const roots: string[] = []

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-review-revision-'))
  roots.push(root)
  const git = (...args: string[]) => run('git', ['-C', root, ...args])
  await git('init', '--quiet')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await writeFile(join(root, 'a.txt'), 'base\n')
  await git('add', 'a.txt')
  await git('commit', '--quiet', '-m', 'base')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('task-workspace review revision', () => {
  it('invalidates old evidence for HEAD-stable staged and unstaged changes', async () => {
    const root = await repo()
    const decided = ReviewRevisionSchema.parse(await captureReviewRevision('tws_one', root))
    await writeFile(join(root, 'a.txt'), 'new\n')
    const unstaged = await captureReviewRevision('tws_one', root)
    expect(unstaged.headRevision).toBe(decided.headRevision)
    expect(reviewRevisionValidity(decided, unstaged)).toBe('stale')
    await run('git', ['-C', root, 'add', 'a.txt'])
    const staged = await captureReviewRevision('tws_one', root)
    expect(reviewRevisionValidity(unstaged, staged)).toBe('stale')
    expect(reviewRevisionValidity(staged, staged)).toBe('current')
  })

  it('covers binary, untracked, rename and deletion changes', async () => {
    const root = await repo()
    const baseline = await captureReviewRevision('tws_one', root)
    await writeFile(join(root, 'blob.bin'), Buffer.from([0, 255, 1, 0]))
    const binary = await captureReviewRevision('tws_one', root)
    expect(reviewRevisionValidity(baseline, binary)).toBe('stale')
    await rename(join(root, 'a.txt'), join(root, 'renamed.txt'))
    const renamed = await captureReviewRevision('tws_one', root)
    expect(reviewRevisionValidity(binary, renamed)).toBe('stale')
    await unlink(join(root, 'renamed.txt'))
    const deleted = await captureReviewRevision('tws_one', root)
    expect(reviewRevisionValidity(renamed, deleted)).toBe('stale')
  })

  it('reports unknown for incomplete scans and old verdicts', async () => {
    const root = await repo()
    await writeFile(join(root, 'large.bin'), Buffer.alloc(32, 7))
    const incomplete = ReviewRevisionSchema.parse(await captureReviewRevision('tws_one', root, {
      maxFileBytes: 8
    }))
    expect(incomplete).toMatchObject({ completeness: 'incomplete', reason: 'file_too_large' })
    expect(reviewRevisionValidity(incomplete, incomplete)).toBe('unknown')
    const current = await captureReviewRevision('tws_one', root)
    expect(reviewRevisionValidity(undefined, current)).toBe('unknown')
    expect(reviewRevisionValidity(current, { ...current, target: { kind: 'task-workspace', workspaceId: 'other' } }))
      .toBe('unknown')
  })

  it('classifies a file changed between stat and read as unknown', async () => {
    const root = await repo()
    await writeFile(join(root, 'new.txt'), 'first\n')
    let changed = false
    const revision = await captureReviewRevision('tws_one', root, {
      onBeforeFileRead: async (path) => {
        if (path.endsWith('new.txt') && !changed) {
          changed = true
          await writeFile(path, 'second with different length\n')
        }
      }
    })
    expect(revision).toMatchObject({
      completeness: 'incomplete', reason: 'concurrent_change'
    })
  })
})
