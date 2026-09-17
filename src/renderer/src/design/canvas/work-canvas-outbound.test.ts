import { describe, expect, it, vi } from 'vitest'
import { ComposerContextAttachmentSchema } from '@kun/extension-api'
import type { CanvasSnapshot } from './canvas-snapshot'
import { createEmptyDocument } from './canvas-types'
import {
  buildWorkCanvasReferenceContext,
  workCanvasReferenceIntent
} from './work-canvas-outbound'
import { snapshotWorkCanvasForPrompt } from './work-canvas'

const snapshot: CanvasSnapshot = {
  shapeCount: 1,
  shapes: [{
    id: 'shape-1', name: 'Selected slide', type: 'frame',
    x: 0, y: 0, w: 480, h: 318, parentName: null, selected: true
  }]
}

describe('workCanvasReferenceIntent', () => {
  it('defaults to focused when the prompt is unknown or empty', () => {
    expect(workCanvasReferenceIntent('')).toBe('default')
    expect(workCanvasReferenceIntent('把 CTA 按钮改成蓝色')).toBe('default')
  })

  it('expands to whole-board for translation/review/export prompts', () => {
    expect(workCanvasReferenceIntent('把整个白板翻译成英文')).toBe('whole-board')
    expect(workCanvasReferenceIntent('Review the full board and list risks')).toBe('whole-board')
    expect(workCanvasReferenceIntent('导出全部文字内容')).toBe('whole-board')
  })

  it('uses a small cap for new-board requests', () => {
    expect(workCanvasReferenceIntent('新建一个登录流程架构图')).toBe('new-board')
    expect(workCanvasReferenceIntent('create a diagram of the auth flow')).toBe('new-board')
  })
})

describe('Work canvas outbound prompt', () => {
  it('emits bounded whiteboard state as a composer reference', async () => {
    const snapshotForPrompt = vi.fn(async (
      _options: Parameters<typeof snapshotWorkCanvasForPrompt>[0]
    ) => snapshot)
    const takeLastErrors = vi.fn(() => [{
      code: 'SHAPE_NOT_FOUND' as const,
      message: 'Missing slide'
    }])

    const context = await buildWorkCanvasReferenceContext({
      workspaceRoot: '/work',
      boardId: 'board-1',
      boardRevision: 7,
      currentDocument: createEmptyDocument(),
      currentDocumentKey: 'document-key',
      selectedIds: new Set(['shape-1']),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' },
      snapshotForPrompt,
      takeLastErrors
    })

    expect(context).toMatchObject({
      title: 'Current Work whiteboard',
      revision: 7,
      reference: {
        kind: 'work-reference-whiteboard',
        boardId: 'board-1',
        designTarget: 'web',
        snapshot: {
          shapeCount: 1,
          includedShapeCount: 1,
          shapes: [{ id: 'shape-1', selected: true }]
        },
        previousErrors: [{ code: 'SHAPE_NOT_FOUND', message: 'Missing slide' }]
      }
    })
    expect(JSON.stringify(context)).not.toContain('Kun is asking you')
    expect(JSON.stringify(context)).not.toContain('/work')
    expect(snapshotForPrompt).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/work', boardId: 'board-1', selectedIds: new Set(['shape-1'])
    }))
    expect(takeLastErrors).toHaveBeenCalledWith('work-canvas:board-1')
  })

  it('shrinks a dense snapshot to the largest schema-valid reference', async () => {
    const shapes = Array.from({ length: 180 }, (_, index) => ({
      id: `shape-${index}`,
      name: `Shape ${index} ${'n'.repeat(200)}`,
      type: 'text' as const,
      x: index * 10,
      y: index * 5,
      w: 240,
      h: 80,
      parentName: null,
      textContent: `Content ${index} ${'x'.repeat(1_000)}`,
      imageUrl: `images/reference-${index}-${'y'.repeat(500)}.png`,
      selected: index === 0
    }))
    const context = await buildWorkCanvasReferenceContext({
      workspaceRoot: '/work',
      boardId: 'board-dense',
      boardRevision: 9,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(['shape-0']),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' },
      snapshotForPrompt: async () => ({ shapeCount: shapes.length, shapes }),
      takeLastErrors: () => []
    })

    expect(ComposerContextAttachmentSchema.parse(context)).toEqual(context)
    expect(context.reference.snapshot).toMatchObject({ shapeCount: 180 })
    const included = (context.reference.snapshot as { includedShapeCount?: number }).includedShapeCount
    expect(included).toBeGreaterThan(0)
    expect(included).toBeLessThanOrEqual(64)
    expect(new TextEncoder().encode(JSON.stringify(context.reference)).byteLength)
      .toBeLessThanOrEqual(16 * 1_024)
  })

  it('omitted count equals shapeCount minus included (no double counting)', async () => {
    // The snapshot layer already truncated 236 of 300 shapes (omitted: 64
    // describes THAT truncation). The reference must not add snapshot.omitted
    // again on top of shapeCount - included.
    const shapes = Array.from({ length: 64 }, (_, index) => ({
      id: `shape-${index}`, name: `Shape ${index}`, type: 'rect' as const,
      x: index, y: index, w: 10, h: 10, parentName: null
    }))
    const context = await buildWorkCanvasReferenceContext({
      workspaceRoot: '/work',
      boardId: 'board-omitted',
      boardRevision: 1,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' },
      intent: 'whole-board',
      snapshotForPrompt: async () => ({
        shapeCount: 300, shapes, omitted: 236
      }),
      takeLastErrors: () => []
    })

    const snapshotRef = context.reference.snapshot as {
      shapeCount: number
      includedShapeCount: number
      omittedShapeCount: number
    }
    expect(snapshotRef.shapeCount).toBe(300)
    expect(snapshotRef.includedShapeCount).toBeGreaterThan(0)
    expect(snapshotRef.includedShapeCount).toBeLessThanOrEqual(64)
    // The fix: omitted is exactly shapeCount - included. The old code added
    // snapshot.omitted again, which could exceed the total shape count.
    expect(snapshotRef.omittedShapeCount).toBe(snapshotRef.shapeCount - snapshotRef.includedShapeCount)
    expect(snapshotRef.omittedShapeCount).toBeLessThan(300)
    expect(snapshotRef.omittedShapeCount).toBeLessThanOrEqual(snapshotRef.shapeCount)
  })

  it('scales the shape cap by intent (focused < whole-board)', async () => {
    const shapes = Array.from({ length: 40 }, (_, index) => ({
      id: `shape-${index}`, name: `Shape ${index}`, type: 'rect' as const,
      x: index, y: index, w: 10, h: 10, parentName: null
    }))
    const base = {
      workspaceRoot: '/work',
      boardId: 'board-intent',
      boardRevision: 1,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set<string>(),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' } as const,
      snapshotForPrompt: async () => ({ shapeCount: shapes.length, shapes }),
      takeLastErrors: () => []
    }

    const focused = await buildWorkCanvasReferenceContext({ ...base, intent: 'default' })
    const whole = await buildWorkCanvasReferenceContext({ ...base, intent: 'whole-board' })
    const newBoard = await buildWorkCanvasReferenceContext({ ...base, intent: 'new-board' })
    const focusedIncluded = (focused.reference.snapshot as { includedShapeCount: number }).includedShapeCount
    const wholeIncluded = (whole.reference.snapshot as { includedShapeCount: number }).includedShapeCount
    const newIncluded = (newBoard.reference.snapshot as { includedShapeCount: number }).includedShapeCount
    expect(focusedIncluded).toBeLessThanOrEqual(18)
    expect(wholeIncluded).toBe(40)
    expect(newIncluded).toBeLessThanOrEqual(8)
  })

  it('peek (non-destructive) keeps errors visible to the next send after a failure', async () => {
    const peekLastErrors = vi.fn(() => [{
      code: 'SHAPE_NOT_FOUND' as const,
      message: 'Missing slide'
    }])
    const context = await buildWorkCanvasReferenceContext({
      workspaceRoot: '/work',
      boardId: 'board-peek',
      boardRevision: 1,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' },
      snapshotForPrompt: async () => snapshot,
      peekLastErrors
    })

    expect(context.reference.previousErrors).toEqual([{ code: 'SHAPE_NOT_FOUND', message: 'Missing slide' }])
    expect(peekLastErrors).toHaveBeenCalledWith('work-canvas:board-peek')
    // Peeking must not clear the bucket: the next send still sees the errors.
    expect(peekLastErrors).toHaveBeenCalledTimes(1)
  })

  it('emits an Excalidraw element summary instead of a Kun snapshot', async () => {
    const snapshotForPrompt = vi.fn()
    const context = await buildWorkCanvasReferenceContext({
      workspaceRoot: '/work',
      boardId: 'board-exo',
      boardRevision: 3,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox: { x: 0, y: 0, width: 1200, height: 800 },
      designContext: { designTarget: 'web' },
      snapshotForPrompt,
      engine: 'excalidraw',
      excalidrawScene: {
        elements: [
          { type: 'rectangle', isDeleted: false },
          { type: 'text', text: 'Auth service', isDeleted: false }
        ]
      }
    })

    expect(ComposerContextAttachmentSchema.safeParse(context).success).toBe(true)
    expect(context.reference).toMatchObject({
      kind: 'work-reference-whiteboard',
      engine: 'excalidraw',
      elementCount: 2
    })
    expect(context.summary).toContain('Excalidraw')
    expect(snapshotForPrompt).not.toHaveBeenCalled()
  })
})
