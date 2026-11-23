import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkAnnotation } from '@shared/work-annotations'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import { createWorkAnnotation, replyWorkAnnotation, resolveWorkAnnotation, retryWorkAnnotation } from './work-annotations'
import * as runtime from './work-annotation-runtime'

const rows = new Map<string, WorkAnnotation>()
vi.mock('./work-annotation-storage', async (original) => ({
  ...await original<typeof import('./work-annotation-storage')>(),
  mutateAnnotation: async (id: string, change: (row?: WorkAnnotation) => WorkAnnotation) => {
    const row = change(structuredClone(rows.get(id)))
    rows.set(id, structuredClone(row))
    return row
  }
}))
vi.mock('./work-annotation-subscriptions', () => ({ notifyAnnotationChange: vi.fn() }))
vi.mock('./work-annotation-runtime', async (original) => ({
  ...await original<typeof import('./work-annotation-runtime')>(),
  annotationRoute: vi.fn(async () => ({ model: 'text', providerId: 'test' })),
  createAnnotationThread: vi.fn(async (row: WorkAnnotation) => 'thread-' + row.id),
  startAnnotationTurn: vi.fn(async (row: WorkAnnotation) => 'turn-' + row.id),
  readAnnotationAnswer: vi.fn()
}))
const doc = { workspaceRoot: '/work', filePath: '/work/story.md' }
const anchor: WorkAnnotationAnchor = { kind: 'markdown', quote: 'word', source: 'word', before: '', after: '', from: 0, unique: true, version: 'digest' }
beforeEach(() => { rows.clear(); vi.clearAllMocks() })

describe('annotation delivery', () => {
  it('saves notes and idempotent draft submissions with zero model requests', async () => {
    await createWorkAnnotation(doc, anchor, 'local note', false, 'first')
    await createWorkAnnotation(doc, anchor, 'local note', false, 'first')
    await replyWorkAnnotation(doc, 'first', 'another local note')
    expect(rows.get('first')?.messages.map((msg) => msg.text)).toEqual(['local note','another local note'])
    expect(runtime.createAnnotationThread).not.toHaveBeenCalled()
    expect(runtime.startAnnotationTurn).not.toHaveBeenCalled()
  })

  it('routes concurrent questions to the originating annotation after another document opens', async () => {
    const done = new Map<string, (text: string) => void>()
    vi.mocked(runtime.readAnnotationAnswer).mockImplementation((id) => new Promise((resolve) => done.set(id, resolve)))
    await createWorkAnnotation(doc, anchor, 'question A', true, 'a')
    const other = { ...doc, filePath: '/work/other.md' }
    await createWorkAnnotation(other, anchor, 'question B', true, 'b')
    await vi.waitFor(() => expect(done.size).toBe(2))
    done.get('thread-b')!('answer B')
    done.get('thread-a')!('answer A')
    await vi.waitFor(() => expect(rows.get('a')?.messages.at(-1)?.text).toBe('answer A'))
    expect(rows.get('b')?.messages.at(-1)?.text).toBe('answer B')
    await expect(resolveWorkAnnotation(other, 'a', true)).rejects.toThrow('no longer belongs')
    expect(rows.get('a')?.resolved).toBe(false)
  })

  it('reattaches to an admitted turn on explicit retry after losing the network', async () => {
    vi.mocked(runtime.readAnnotationAnswer).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('restored reply')
    await createWorkAnnotation(doc, anchor, 'question', true, 'lost')
    await vi.waitFor(() => expect(rows.get('lost')?.messages.at(-1)?.status).toBe('failed'))
    await retryWorkAnnotation(doc, 'lost')
    await vi.waitFor(() => expect(rows.get('lost')?.messages.at(-1)?.text).toBe('restored reply'))
    expect(runtime.startAnnotationTurn).toHaveBeenCalledTimes(1)
    expect(runtime.createAnnotationThread).toHaveBeenCalledTimes(1)
  })
})
