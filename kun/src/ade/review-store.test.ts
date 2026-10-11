import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileReviewStore } from './review-store.js'
import { writeAdeJson } from './ade-file.js'
import { adeReviewFile } from './ade-paths.js'
import { InMemoryArtifactStore } from '../artifacts/artifact-store.js'

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
  it('stores a host-generated revision with each new comment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-reviews-'))
    dirs.push(dir)
    const revision = {
      version: 1 as const,
      target: { kind: 'task-workspace' as const, workspaceId: 'tws_1' },
      contentHash: 'a'.repeat(64),
      completeness: 'complete' as const,
      fileCount: 1,
      capturedAt: NOW
    }
    const store = new FileReviewStore(dir, () => NOW, nextId, async () => revision)
    const comment = await store.create('tws_1', commentInput)
    expect(comment.revision).toEqual(revision)
    expect((await store.list('tws_1')).comments[0]?.revision).toEqual(revision)
  })

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

  it('refuses the 201st round before side effects without corrupting prior history', async () => {
    const store = await harness()
    for (let round = 1; round <= 200; round += 1) {
      await store.markSent('tws_1', {
        requestId: store.nextRequestId(), round,
        target: { kind: 'manager' }, commentIds: [], note: `round ${round}`, sentAt: NOW
      })
    }
    const reserved = await store.reserveSend('tws_1', {
      clientRequestId: 'overflow', requestHash: 'a'.repeat(64),
      target: { kind: 'manager' }, commentIds: [], note: 'another round'
    })
    expect(reserved.kind).toBe('history_full')
    await expect(store.markSent('tws_1', {
      requestId: store.nextRequestId(), round: 201,
      target: { kind: 'manager' }, commentIds: [], note: 'overflow', sentAt: NOW
    })).rejects.toThrow(/history is full/)
    const file = await store.list('tws_1')
    expect(file.requests).toHaveLength(200)
    expect(file.requests.at(-1)?.round).toBe(200)
    expect(file.reservations).toHaveLength(0)
  })

  it('reads a legacy file with 201 sent rounds without discarding its history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-reviews-'))
    dirs.push(dir)
    const requests = Array.from({ length: 201 }, (_, index) => ({
      requestId: `rvq_${String(index + 1).padStart(8, '0')}`,
      round: index + 1,
      target: { kind: 'manager' as const },
      commentIds: [],
      sentAt: NOW
    }))
    await writeAdeJson(adeReviewFile(dir, 'tws_1'), { comments: [], requests })
    const store = new FileReviewStore(dir, () => NOW, nextId)
    expect((await store.list('tws_1')).requests).toHaveLength(201)
    expect((await store.reserveSend('tws_1', {
      clientRequestId: 'new', requestHash: 'a'.repeat(64),
      target: { kind: 'manager' }, commentIds: [], note: 'new'
    })).kind).toBe('history_full')
    expect((await store.list('tws_1')).requests.at(-1)?.round).toBe(201)
  })
  it('preserves a large legal batch and uses a complete artifact for worker delivery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-reviews-large-'))
    dirs.push(dir)
    const artifacts = new InMemoryArtifactStore()
    const store = new FileReviewStore(dir, () => NOW, nextId, undefined, artifacts)
    const first = await store.create('tws_large0001', commentInput)
    const comments = Array.from({ length: 200 }, (_, index) => ({
      ...first, commentId: `rvc_${String(index).padStart(8, '0')}`,
      line: index + 1, body: 'B'.repeat(3_980) + ` LAST-${index}`,
      anchor: { ...first.anchor, lineText: 'A'.repeat(2_000) }
    }))
    await writeAdeJson(adeReviewFile(dir, 'tws_large0001'), { comments, requests: [] })
    const reserved = await store.reserveSend('tws_large0001', {
      clientRequestId: 'large-batch', requestHash: 'a'.repeat(64),
      commentIds: comments.map((comment) => comment.commentId),
      target: { kind: 'worker', workerId: 'worker' }
    })
    expect(reserved.kind).toBe('reserved')
    if (reserved.kind !== 'reserved') return
    expect(reserved.reservation.requestText.length).toBeGreaterThan(1_048_576)
    expect(await artifacts.get(reserved.reservation.requestArtifactId!))
      .toBe(reserved.reservation.requestText)
    const receipt = await store.completeSend('tws_large0001', reserved.reservation.requestId, { dispatchId: 'dispatch' })
    await store.update('tws_large0001', comments[0].commentId, { body: 'later edit' })
    const restored = new FileReviewStore(dir, () => NOW, nextId)
    const sent = await restored.getSentRequest('tws_large0001', receipt.requestId)
    expect(sent?.requestText).toBe(reserved.reservation.requestText)
    expect(sent?.requestText).toContain('LAST-199')
    expect(sent?.workspaceId).toBe('tws_large0001')
  })

})
