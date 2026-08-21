import { describe, expect, it, vi } from 'vitest'
import {
  applyImageAnnotationResult,
  isCodeCanvasDocumentKey,
  isDesignCanvasDocumentKey
} from './image-annotation-dispatch'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import type { DesignArtifact } from '../design-types'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'

const boardArtifact: DesignArtifact = {
  id: 'board',
  kind: 'canvas',
  title: 'Board',
  relativePath: '.kun-design/doc/board/canvas.json',
  createdAt: '2026-07-02T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  versions: []
}

function fakeCanvasState() {
  const image = createDefaultShape('image', 10, 20)
  image.id = 'image_1'
  image.imageUrl = '.kun/images/source.png'
  const document = createEmptyDocument()
  document.objects[image.id] = image
  return {
    document,
    documentKey: 'design-doc',
    updateShape: vi.fn((id: string, patch: Partial<typeof image>) => {
      Object.assign(document.objects[id] ?? {}, patch)
    })
  } as unknown as ReturnType<typeof useCanvasShapeStore.getState>
}

function fakeDesignState() {
  return {
    artifacts: [boardArtifact],
    setActiveArtifact: vi.fn()
  } as unknown as ReturnType<typeof useDesignWorkspaceStore.getState>
}

function baseOptions() {
  return {
    result: {
      dataBase64: 'abc',
      mimeType: 'image/png',
      instruction: 'make the accent red'
    },
    shapeId: 'image_1',
    currentDocumentKey: 'design-doc',
    route: 'design',
    activeCodeCanvasWorkspace: '/code',
    designWorkspaceRoot: '/design',
    workspaceRequiredMessage: 'Workspace required',
    unsupportedSaveMessage: 'Save unsupported',
    saveFailedMessage: (message: string) => `Save failed: ${message}`,
    setError: vi.fn(),
    setDesignFileError: vi.fn(),
    setAnnotationBusy: vi.fn(),
    closeImageAnnotation: vi.fn(),
    sendCodeCanvasPrompt: vi.fn(),
    sendDesignPrompt: vi.fn(),
    saveWorkspaceImageBytes: vi.fn(async () => ({
      ok: true as const,
      workspaceRelativePath: '.deepseekgui-images/annotated.png'
    })),
    selectCanvasShapes: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => {
      callback()
      return 1
    })
  }
}

describe('image annotation dispatch', () => {
  it('detects code-canvas document keys', () => {
    expect(isCodeCanvasDocumentKey(`workspace\0.kun-canvas/code-thread/canvas.json`)).toBe(true)
    expect(isCodeCanvasDocumentKey('workspace/.kun-design/doc/canvas.json')).toBe(false)
  })

  it('detects embedded Design document keys', () => {
    expect(isDesignCanvasDocumentKey(`workspace\0.kun-design/doc/board/canvas.json`)).toBe(true)
    expect(isDesignCanvasDocumentKey(`workspace\0.kun-canvas/code-thread/canvas.json`)).toBe(false)
  })

  it('saves the annotated image and routes a design repair turn', async () => {
    const canvasState = fakeCanvasState()
    const designState = fakeDesignState()
    const options = baseOptions()

    const status = await applyImageAnnotationResult({
      ...options,
      getCanvasShapeState: () => canvasState,
      getDesignState: () => designState
    })

    expect(status).toBe('sent-design')
    expect(options.saveWorkspaceImageBytes).toHaveBeenCalledWith({
      workspaceRoot: '/design',
      dataBase64: 'abc',
      mimeType: 'image/png'
    })
    expect(canvasState.updateShape).not.toHaveBeenCalled()
    expect(canvasState.document.objects.image_1?.imageUrl).toBe('.kun/images/source.png')
    expect(options.selectCanvasShapes).toHaveBeenCalledWith(['image_1'])
    expect(designState.setActiveArtifact).toHaveBeenCalledWith('board')
    expect(options.closeImageAnnotation).toHaveBeenCalled()
    expect(options.sendDesignPrompt).toHaveBeenCalledWith(
      expect.stringContaining('.deepseekgui-images/annotated.png'),
      {
        displayText: '按图片批注修改：make the accent red',
        imageEditReferencePath: '.deepseekgui-images/annotated.png'
      }
    )
    expect(options.sendCodeCanvasPrompt).not.toHaveBeenCalled()
    expect(options.setAnnotationBusy).toHaveBeenNthCalledWith(1, true)
    expect(options.setAnnotationBusy).toHaveBeenLastCalledWith(false)
  })

  it('routes code-canvas annotations back to the code canvas prompt lane', async () => {
    const canvasState = fakeCanvasState()
    const designState = fakeDesignState()
    const options = baseOptions()

    const status = await applyImageAnnotationResult({
      ...options,
      currentDocumentKey: `workspace\0.kun-canvas/code-thread/canvas.json`,
      getCanvasShapeState: () => ({
        ...canvasState,
        documentKey: `workspace\0.kun-canvas/code-thread/canvas.json`
      }),
      getDesignState: () => designState
    })

    expect(status).toBe('sent-code')
    expect(options.saveWorkspaceImageBytes).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/code'
    }))
    expect(options.sendCodeCanvasPrompt).toHaveBeenCalledWith(
      expect.stringContaining('.deepseekgui-images/annotated.png'),
      { displayText: '按图片批注修改：make the accent red' }
    )
    expect(canvasState.updateShape).toHaveBeenCalledWith('image_1', {
      imageUrl: '.deepseekgui-images/annotated.png'
    })
    expect(options.sendDesignPrompt).not.toHaveBeenCalled()
    expect(designState.setActiveArtifact).not.toHaveBeenCalled()
  })

  it('does not apply a saved annotation after the active canvas changes', async () => {
    const canvasState = fakeCanvasState()
    const options = baseOptions()
    const status = await applyImageAnnotationResult({
      ...options,
      currentDocumentKey: 'original-design-doc',
      getCanvasShapeState: () => canvasState
    })

    expect(status).toBe('document-changed')
    expect(canvasState.updateShape).not.toHaveBeenCalled()
    expect(options.sendDesignPrompt).not.toHaveBeenCalled()
  })

  it('does not send the delayed repair prompt after the active canvas changes', async () => {
    const canvasState = fakeCanvasState()
    const options = baseOptions()
    let pendingSend!: () => void
    const status = await applyImageAnnotationResult({
      ...options,
      getCanvasShapeState: () => canvasState,
      setTimeout: vi.fn((callback: () => void) => {
        pendingSend = callback
        return 1
      })
    })

    expect(status).toBe('sent-design')
    canvasState.documentKey = 'next-design-doc'
    pendingSend()
    expect(options.sendDesignPrompt).not.toHaveBeenCalled()
  })

  it('does not send the delayed repair prompt after the active thread changes', async () => {
    const canvasState = fakeCanvasState()
    const options = baseOptions()
    let activeThreadId = 'thread-original'
    let pendingSend!: () => void
    const status = await applyImageAnnotationResult({
      ...options,
      initiatingThreadId: activeThreadId,
      getActiveThreadId: () => activeThreadId,
      getCanvasShapeState: () => canvasState,
      setTimeout: vi.fn((callback: () => void) => {
        pendingSend = callback
        return 1
      })
    })

    expect(status).toBe('sent-design')
    activeThreadId = 'thread-next'
    pendingSend()
    expect(options.sendDesignPrompt).not.toHaveBeenCalled()
  })
})
