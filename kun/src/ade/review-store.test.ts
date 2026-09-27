import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileReviewStore } from './review-store.js'

const NOW = '2026-09-01T12:00:00.000Z'
const dirs: string[] = []
let seq = 0

const nextId = (prefix: 'rvc' | 'rvq'): string =>
  `${prefix}_${(++seq).toString(36)}aaaaaaa`.slice(0, 40)

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-reviews-'))
  dirs.push(dir)
  return new FileReviewStore(dir, () => NOW, nextId)
}

const commentInput = {
  path: 'src/a.ts',
  side: 'new' as const,
  line: 3,
  anchor: { lineText: 'const x = 1', before: ['b1'], after: ['a1'] },
  body: 'use a constant'
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe('FileReviewStore', () => {
  it('creates drafts, edits bodies, resolves, and marks sent', async () => {
    const store = await harness()
    const comment = await store.create('tws_1', commentInput)
    expect(comment.commentId).toMatch(/^rvc_/)
    expect(comment.state).toBe('draft')
    expect(comment.author).toBe('user')

    const edited = await store.update('tws_1', comment.commentId, { body: 'renamed' })
    expect(edited?.body).toBe('renamed')

    const resolved = await store.update('tws_1', comment.commentId, { state: 'resolved' })
    expect(resolved?.state).toBe('resolved')

    const second = await store.create('tws_1', { ...commentInput, line: 5 })
    const marked = await store.markSent('tws_1', {
      requestId: store.nextRequestId(),
      round: 1,
      target: { kind: 'manager' },
      commentIds: [second.commentId],
      sentAt: NOW
    })
    expect(marked[0]?.state).toBe('sent')
    expect(marked[0]?.sentInRequestId).toMatch(/^rvq_/)
    const file = await store.list('tws_1')
    expect(file.requests).toHaveLength(1)
    expect(file.requests[0].round).toBe(1)
  })

  it('persists per workspace and isolates ids', async () => {
    const store = await harness()
    await store.create('tws_a', commentInput)
    await store.create('tws_b', { ...commentInput, body: 'other' })
    expect((await store.list('tws_a')).comments).toHaveLength(1)
    expect((await store.list('tws_b')).comments).toHaveLength(1)
    expect((await store.list('tws_c')).comments).toHaveLength(0)
  })

  it('reanchorResult writes back line/outdated for open comments only', async () => {
    const store = await harness()
    const open = await store.create('tws_1', commentInput)
    const resolved = await store.create('tws_1', { ...commentInput, line: 7 })
    await store.update('tws_1', resolved.commentId, { state: 'resolved' })
    await store.reanchorResult('tws_1', [
      { commentId: open.commentId, line: 12, outdated: false },
      { commentId: resolved.commentId, line: 99, outdated: true }
    ])
    const file = await store.list('tws_1')
    expect(file.comments.find((c) => c.commentId === open.commentId)?.line).toBe(12)
    const stillResolved = file.comments.find((c) => c.commentId === resolved.commentId)
    expect(stillResolved?.line).toBe(7)
    expect(stillResolved?.outdated).toBe(false)
  })

  it('reopening a draft clears the sent request id', async () => {
    const store = await harness()
    const comment = await store.create('tws_1', commentInput)
    await store.markSent('tws_1', {
      requestId: store.nextRequestId(),
      round: 1,
      target: { kind: 'worker', workerId: 'w1' },
      commentIds: [comment.commentId],
      sentAt: NOW
    })
    const draft = await store.update('tws_1', comment.commentId, { state: 'draft' })
    expect(draft?.sentInRequestId).toBeUndefined()
  })
})
