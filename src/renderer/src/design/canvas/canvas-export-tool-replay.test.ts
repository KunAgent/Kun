import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { dispatchCanvasExportToolBlock } from './canvas-export-tool-replay'

const mocks = vi.hoisted(() => ({ sendCanvasTurnReceipt: vi.fn() }))

vi.mock('./canvas-receipt-sender', () => ({
  sendCanvasTurnReceipt: (...args: unknown[]) => mocks.sendCanvasTurnReceipt(...args)
}))

const block: ToolBlock = {
  kind: 'tool',
  id: 'tool-export-1',
  summary: 'design_export_canvas',
  status: 'success',
  turnId: 'turn-export-1',
  detail: '{}',
  meta: {
    toolName: 'design_export_canvas'
  }
}

const parsed = {
  status: 'accepted',
  receiptKey: 'design-receipt-export',
  exportRequest: {
    format: 'png',
    fileName: 'architecture.png',
    relativePath: '.kun/images/architecture.png'
  }
}

describe('canvas export tool replay', () => {
  beforeEach(() => {
    mocks.sendCanvasTurnReceipt.mockClear()
    useChatStore.setState({ blocks: [block] })
    useDesignWorkspaceStore.setState({ fileError: null })
  })

  it('publishes the saved file preview after the renderer export succeeds', async () => {
    const onRequest = vi.fn(async () => ({
      name: 'architecture.png',
      relativePath: '.kun/images/architecture.png',
      absolutePath: '/workspace/.kun/images/architecture.png',
      mimeType: 'image/png' as const,
      byteSize: 128,
      previewUrl: 'data:image/png;base64,aW1hZ2U='
    }))
    const applied = new Set<string>()

    expect(dispatchCanvasExportToolBlock(block, parsed, applied, onRequest, {
      threadId: 'thread-1',
      turnId: 'turn-export-1'
    })).toBe(true)
    expect(applied).toEqual(new Set([block.id]))
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledWith(parsed.exportRequest))
    await vi.waitFor(() => {
      const updated = useChatStore.getState().blocks[0]
      expect(updated.kind === 'tool' ? updated.meta?.generatedFiles : undefined).toEqual([
        expect.objectContaining({
          relativePath: '.kun/images/architecture.png',
          previewUrl: 'data:image/png;base64,aW1hZ2U='
        })
      ])
    })
    expect(mocks.sendCanvasTurnReceipt).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnId: 'turn-export-1',
      receiptKey: 'design-receipt-export',
      affectedIds: [],
      errors: [],
      generatedFiles: [{
        name: 'architecture.png',
        relativePath: '.kun/images/architecture.png',
        absolutePath: '/workspace/.kun/images/architecture.png',
        mimeType: 'image/png',
        byteSize: 128
      }]
    })
  })

  it('marks malformed renderer export requests as failed', () => {
    expect(dispatchCanvasExportToolBlock(block, {}, new Set(), vi.fn())).toBe(true)
    const updated = useChatStore.getState().blocks[0]
    expect(updated).toMatchObject({
      kind: 'tool',
      status: 'error',
      summary: 'Whiteboard export failed',
      detail: 'Whiteboard export request is invalid.'
    })
    expect(useDesignWorkspaceStore.getState().fileError).toBe('Whiteboard export request is invalid.')
  })

  it('reports renderer export failures back to the pending runtime tool', async () => {
    const onRequest = vi.fn(async () => {
      throw new Error('PNG encoding failed')
    })
    expect(dispatchCanvasExportToolBlock(block, parsed, new Set(), onRequest, {
      threadId: 'thread-1',
      turnId: 'turn-export-1'
    })).toBe(true)

    await vi.waitFor(() => expect(mocks.sendCanvasTurnReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-export-1',
        receiptKey: 'design-receipt-export',
        errors: [{
          code: 'CANVAS_EXPORT_FAILED',
          message: 'Whiteboard export failed: PNG encoding failed'
        }]
      })
    ))
  })
})
