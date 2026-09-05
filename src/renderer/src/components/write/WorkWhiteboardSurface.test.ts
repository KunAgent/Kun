import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { canvasDocumentKey } from '../../design/canvas/canvas-persistence'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { createDefaultShape, createEmptyDocument } from '../../design/canvas/canvas-types'
import { resetWritableWorkCanvasForTests } from '../../design/canvas/work-canvas'
import type { CanvasDocument } from '../../design/canvas/canvas-types'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { WorkWhiteboardSurface } from './WorkWhiteboardSurface'

const mocks = vi.hoisted(() => ({
  applyLive: vi.fn(),
  flush: vi.fn(async () => undefined)
}))

vi.mock('../design/canvas/CanvasViewport', async () => {
  const { createElement } = await import('react')
  return {
    CanvasViewport: (props: Record<string, unknown>) => createElement('div', {
      'data-mock-canvas': props.artifactId,
      'data-mock-surface': props.surface,
      'data-mock-base-dir': props.baseDir,
      onDocumentLoadStateChange: props.onDocumentLoadStateChange
    })
  }
})

vi.mock('../design/canvas/PropertiesPanel', async () => {
  const { createElement } = await import('react')
  return {
    PropertiesPanel: (props: Record<string, unknown>) => createElement('div', {
      'data-mock-properties': props.surface
    })
  }
})

vi.mock('../../design/canvas/use-apply-shape-ops-live', () => ({
  useApplyShapeOpsLive: (...args: unknown[]) => mocks.applyLive(...args)
}))

vi.mock('../../design/canvas/canvas-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../design/canvas/canvas-persistence')>(),
  flushPendingCanvasDocuments: mocks.flush
}))

const baseProps = {
  workspaceRoot: '/work',
  boardId: 'board-1',
  activeThreadId: 'thread-1',
  title: 'Pitch review',
  workflowId: 'workflow-1',
  childId: 'child-1',
  phase: 'review' as const
}

const originalUpdateWhiteboardPptState = useWriteWorkspaceStore.getState().updateWhiteboardPptState

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.applyLive.mockClear()
  mocks.flush.mockClear()
  resetWritableWorkCanvasForTests()
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), null)
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = null
  resetWritableWorkCanvasForTests()
  useWriteWorkspaceStore.setState({ updateWhiteboardPptState: originalUpdateWhiteboardPptState })
  vi.unstubAllGlobals()
})

async function render(element: ReturnType<typeof createElement>): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(element)
    await Promise.resolve()
  })
  return renderer!
}

function addReviewProjection(document: CanvasDocument): void {
  const frame = createDefaultShape('frame', 0, 0)
  frame.id = 'review-frame'
  frame.pptReviewRef = {
    workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
    revision: 1, role: 'slide-frame'
  }
  const preview = createDefaultShape('image', 0, 0)
  preview.id = 'review-preview'
  preview.imageUrl = '.kun/images/slide-1.png'
  preview.pptReviewRef = {
    workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
    revision: 1, role: 'preview-image'
  }
  for (const shape of [frame, preview]) {
    document.objects[shape.id] = { ...shape, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(shape.id)
  }
}

function reviewDocument(): CanvasDocument {
  const document = createEmptyDocument()
  addReviewProjection(document)
  return document
}

function markCanvasDocumentLoaded(view: ReactTestRenderer, boardId = 'board-1'): void {
  const canvas = view.root.findByProps({ 'data-mock-canvas': boardId })
  const expectedKey = canvasDocumentKey('/work', boardId, '.kun-whiteboards')
  act(() => {
    if (useCanvasShapeStore.getState().documentKey !== expectedKey) {
      useCanvasShapeStore.getState().loadDocument(reviewDocument(), expectedKey)
    }
    canvas.props.onDocumentLoadStateChange(true)
  })
}

describe('WorkWhiteboardSurface', () => {
  it('renders a safe activation placeholder without mounting singleton stores', async () => {
    const onActivate = vi.fn()
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, writable: false, onActivate
    }))

    expect(view.root.findAllByProps({ 'data-work-whiteboard-placeholder': 'true' })).toHaveLength(1)
    expect(view.root.findAllByProps({ 'data-mock-canvas': 'board-1' })).toHaveLength(0)
    expect(mocks.applyLive).not.toHaveBeenCalled()
    act(() => view.root.findByType('button').props.onClick())
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('mounts Work surface with the durable key and workflow-gated replay', async () => {
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, writable: true
    }))

    expect(view.root.findByProps({ 'data-mock-canvas': 'board-1' }).props).toMatchObject({
      'data-mock-surface': 'work',
      'data-mock-base-dir': '.kun-whiteboards'
    })
    expect(view.root.findByProps({ 'data-mock-properties': 'work' })).toBeTruthy()
    expect(mocks.applyLive).toHaveBeenCalledWith(
      true, undefined, expect.objectContaining({ lintFeedbackKey: 'work-canvas:board-1' }),
      'work-canvas:board-1', 'thread-1', undefined, undefined, undefined,
      canvasDocumentKey('/work', 'board-1', '.kun-whiteboards'),
      expect.objectContaining({ workflowId: 'workflow-1' }),
      'work'
    )
  })

  it('uses an unbound gate so a blank board ignores unrelated PPT bundles', async () => {
    await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, workflowId: undefined, phase: 'blank', writable: true
    }))

    expect(mocks.applyLive.mock.calls.at(-1)?.[9]).toEqual(expect.objectContaining({
      workflowId: '__unbound-work-board__:board-1'
    }))
  })

  it('never mounts two writable Work canvases at once', async () => {
    const view = await render(createElement(Fragment, null,
      createElement(WorkWhiteboardSurface, { ...baseProps, writable: true }),
      createElement(WorkWhiteboardSurface, {
        ...baseProps, boardId: 'board-2', title: 'Second board', writable: true
      })
    ))

    expect(view.root.findAllByProps({ 'data-work-whiteboard-mounted': 'board-1' })).toHaveLength(1)
    expect(view.root.findAllByProps({ 'data-work-whiteboard-mounted': 'board-2' })).toHaveLength(0)
    expect(view.root.findAllByProps({ 'data-work-whiteboard-placeholder': 'true' })).toHaveLength(1)
  })

  it('disables approval while the board has an unresolved blocking QA note', async () => {
    const document = createEmptyDocument()
    addReviewProjection(document)
    const note = createDefaultShape('rect', 0, 0)
    note.agentNote = { kind: 'critique', body: 'Text overflow', severity: 'error' }
    note.pptReviewRef = {
      workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
      revision: 1, role: 'annotation'
    }
    document.objects[note.id] = { ...note, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(note.id)
    useCanvasShapeStore.getState().loadDocument(
      document,
      canvasDocumentKey('/work', 'board-1', '.kun-whiteboards')
    )

    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, writable: true, onRequestAssistant: vi.fn()
    }))
    markCanvasDocumentLoaded(view)
    const approve = view.root.findByProps({
      'data-work-whiteboard-action': 'workWhiteboardApproveExport'
    })
    expect(approve.props.disabled).toBe(true)
    expect(approve.props.title).toContain('Resolve blocking QA issues')
  })

  it('fails closed until the expected board document has settled', async () => {
    const onRequestAssistant = vi.fn()
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, writable: true, onRequestAssistant
    }))
    const approve = view.root.findByProps({
      'data-work-whiteboard-action': 'workWhiteboardApproveExport'
    })

    expect(approve.props.disabled).toBe(true)
    expect(approve.props.title).toContain('finish loading')
    act(() => approve.props.onClick())
    expect(onRequestAssistant).not.toHaveBeenCalled()

    markCanvasDocumentLoaded(view)
    const settledApprove = view.root.findByProps({
      'data-work-whiteboard-action': 'workWhiteboardApproveExport'
    })
    expect(settledApprove.props.disabled).toBe(false)
    act(() => settledApprove.props.onClick())
    expect(onRequestAssistant).toHaveBeenCalledOnce()
  })

  it('keeps approval disabled when review metadata still points at direction cards', async () => {
    const document = createEmptyDocument()
    const direction = createDefaultShape('frame', 0, 0)
    direction.pptDirectionRef = {
      workflowId: 'workflow-1', childId: 'child-1', directionId: 'direction-1',
      revision: 1, role: 'direction-card'
    }
    document.objects[direction.id] = { ...direction, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(direction.id)
    useCanvasShapeStore.getState().loadDocument(
      document,
      canvasDocumentKey('/work', 'board-1', '.kun-whiteboards')
    )
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, writable: true, onRequestAssistant: vi.fn()
    }))
    markCanvasDocumentLoaded(view)

    const approve = view.root.findByProps({
      'data-work-whiteboard-action': 'workWhiteboardApproveExport'
    })
    expect(approve.props.disabled).toBe(true)
    expect(approve.props.title).toContain('finish loading')
  })

  it('persists a projected review before committing whiteboard phase metadata', async () => {
    const updateWhiteboardPptState = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work', updateWhiteboardPptState
    })
    await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, phase: 'directions', writable: true
    }))
    mocks.flush.mockClear()
    const projectionOptions = mocks.applyLive.mock.calls.at(-1)?.[9] as {
      onOpenRequested: (request: Record<string, unknown>) => void
    }

    await act(async () => {
      projectionOptions.onOpenRequested({
        blockId: 'review-tool', workflowId: 'workflow-1', childId: 'child-1', phase: 'review',
        pptState: { phase: 'review', revision: 2 }
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.flush).toHaveBeenCalledWith('/work')
    expect(updateWhiteboardPptState).toHaveBeenCalledWith('board-1', {
      phase: 'review', revision: 2, childId: 'child-1'
    })
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
      updateWhiteboardPptState.mock.invocationCallOrder[0]
    )
  })

  it('keeps direction confirmation in chat when no whiteboard card is selected', async () => {
    const onRequestAssistant = vi.fn()
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps, phase: 'directions', writable: true, onRequestAssistant
    }))
    const adopt = view.root.findByProps({
      'data-work-whiteboard-action': 'workWhiteboardAdoptDirection'
    })

    expect(adopt.props.disabled).toBe(false)
    expect(adopt.findByType('span').children).toContain('Use recommended direction and continue')
    act(() => adopt.props.onClick())
    expect(onRequestAssistant).toHaveBeenCalledWith(
      '采用当前 PPT 工作流的推荐视觉方向，并继续生成逐页演示稿。'
    )
  })

  it('opens the exported PPTX through the existing Work file preview path', async () => {
    const onOpenOutput = vi.fn()
    const view = await render(createElement(WorkWhiteboardSurface, {
      ...baseProps,
      phase: 'complete',
      outputPath: '/work/presentations/final.pptx',
      writable: true,
      onOpenOutput
    }))
    const open = view.root.findAllByType('button').find((button) =>
      button.children.some((child) => child === 'Open PPTX')
    )
    expect(open).toBeDefined()
    act(() => open!.props.onClick())
    expect(onOpenOutput).toHaveBeenCalledWith('/work/presentations/final.pptx')
  })
})
