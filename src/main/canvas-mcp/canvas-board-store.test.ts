import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBoardError, CanvasBoardStore, summarizeElements } from './canvas-board-store'

describe('CanvasBoardStore', () => {
  let dir: string
  let store: CanvasBoardStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-canvas-'))
    store = new CanvasBoardStore(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates boards from model skeletons and lists them', async () => {
    const board = await store.create('Architecture', [
      { id: 'api', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, label: { text: 'API' } },
      { type: 'text', x: 0, y: 100, text: 'note' }
    ])
    expect(board.boardId).toMatch(/^cb_[a-z0-9]{12}$/)
    expect(board.pending).toBe(true)
    expect(board.elements[0]).toMatchObject({ id: 'api', kunSkeleton: true })
    expect(board.elements[1]!.id).toMatch(/^el_/)
    expect((await store.list())[0]).toMatchObject({ boardId: board.boardId, elementCount: 2 })
    await expect(store.create('x', [{ type: 'image', x: 0, y: 0 }])).rejects.toBeInstanceOf(CanvasBoardError)
    await expect(store.create('x', [{ type: 'rectangle', x: 'a', y: 0 }])).rejects.toThrow(/numeric/)
  })

  it('applies revisioned operations idempotently and reports conflicts', async () => {
    const board = await store.create('Flow', [
      { id: 'a', type: 'rectangle', x: 0, y: 0, label: { text: 'A' } },
      { id: 'b', type: 'rectangle', x: 200, y: 0 },
      { id: 'ab', type: 'arrow', x: 120, y: 30, startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } }
    ])
    const first = await store.apply({
      boardId: board.boardId,
      expectedRevision: 1,
      operationId: 'op-1',
      operations: [
        { op: 'update', id: 'a', props: { strokeColor: '#ff0000', label: { text: 'API' }, evil: 1 } },
        { op: 'delete', id: 'b' }
      ]
    })
    expect(first.replayed).toBe(false)
    expect(first.board.revision).toBe(2)
    const updated = first.board.elements.find((element) => element.id === 'a')!
    expect(updated).toMatchObject({ strokeColor: '#ff0000', label: { text: 'API' } })
    expect(updated).not.toHaveProperty('evil')
    expect(first.board.elements.find((element) => element.id === 'ab')!.endBinding).toBeNull()
    const replay = await store.apply({ boardId: board.boardId, expectedRevision: 1, operationId: 'op-1', operations: [] })
    expect(replay).toMatchObject({ replayed: true, board: { revision: 2 } })
    await expect(store.apply({ boardId: board.boardId, expectedRevision: 1, operations: [{ op: 'delete', id: 'a' }] }))
      .rejects.toMatchObject({ code: 'conflict', revision: 2 })
    await expect(store.apply({ boardId: board.boardId, expectedRevision: 2, operations: [{ op: 'delete', id: 'zzz' }] }))
      .rejects.toThrow(/unknown element/)
  })

  it('accepts full drafts from the page and clears pending normalization', async () => {
    const board = await store.create('Draft', [{ id: 'a', type: 'rectangle', x: 0, y: 0 }])
    const saved = await store.commit({
      boardId: board.boardId,
      expectedRevision: 1,
      elements: [{ id: 'a', type: 'rectangle', x: 5, y: 5, version: 3, kunSkeleton: true }],
      appState: { viewBackgroundColor: '#fff' }
    })
    expect(saved).toMatchObject({ revision: 2, pending: false, appState: { viewBackgroundColor: '#fff' } })
    expect(saved.elements[0]).not.toHaveProperty('kunSkeleton')
    await expect(store.commit({ boardId: board.boardId, expectedRevision: 1, elements: [] }))
      .rejects.toMatchObject({ code: 'conflict' })
    await expect(store.read('cb_doesnotexist')).rejects.toMatchObject({ code: 'not_found' })
    await expect(store.read('../../etc/passwd')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('summarizes containers with their bound label text and skips deleted elements', () => {
    const summary = summarizeElements([
      { id: 'box', type: 'rectangle', x: 1.4, y: 2.6, width: 100, height: 40, boundElements: [{ type: 'text', id: 't1' }] },
      { id: 't1', type: 'text', x: 0, y: 0, text: 'Cache', containerId: 'box' },
      { id: 'gone', type: 'ellipse', x: 0, y: 0, isDeleted: true }
    ])
    expect(summary).toEqual([{ id: 'box', type: 'rectangle', x: 1, y: 3, width: 100, height: 40, text: 'Cache' }])
  })
})
