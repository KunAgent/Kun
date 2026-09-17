import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import {
  excalidrawApplyRequestFromBlock,
  useApplyExcalidrawLive
} from './use-apply-excalidraw-live'

const mocks = vi.hoisted(() => ({
  sendReceipt: vi.fn(),
  apply: vi.fn()
}))

vi.mock('../design/canvas/canvas-receipt-sender', () => ({
  sendCanvasTurnReceipt: (...args: unknown[]) => mocks.sendReceipt(...args)
}))

vi.mock('./excalidraw-apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./excalidraw-apply')>()
  return {
    ...actual,
    applyOpenExcalidrawScene: (...args: unknown[]) => mocks.apply(...args)
  }
})

function Harness(): null {
  useApplyExcalidrawLive({
    enabled: true,
    threadId: 'thread-1',
    workspaceRoot: '/work',
    identityId: 'board-1',
    baseDir: '.kun-whiteboards'
  })
  return null
}

describe('useApplyExcalidrawLive', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.sendReceipt.mockClear()
    mocks.apply.mockReset()
    mocks.apply.mockResolvedValue({
      ok: true,
      pngRelativePath: '.kun-whiteboards/board-1/excalidraw.png',
      pngByteSize: 12,
      elementCount: 2
    })
    useChatStore.setState({
      activeThreadId: 'thread-1',
      currentTurnId: 'turn-1',
      blocks: []
    })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it('parses only accepted apply_excalidraw results', () => {
    const block = {
      kind: 'tool' as const,
      id: 'tool-apply',
      turnId: 'turn-1',
      summary: 'apply',
      status: 'success' as const,
      meta: { toolName: 'design_apply_excalidraw', sourceItemKind: 'tool_result' as const },
      detail: JSON.stringify({
        tool: 'design_apply_excalidraw',
        action: 'apply_excalidraw',
        status: 'accepted',
        receiptKey: 'design-receipt-1'
      })
    }
    expect(excalidrawApplyRequestFromBlock(block)).toEqual({
      receiptKey: 'design-receipt-1',
      turnId: 'turn-1'
    })
    expect(excalidrawApplyRequestFromBlock({
      ...block,
      detail: JSON.stringify({
        tool: 'design_apply_excalidraw',
        action: 'apply_excalidraw',
        status: 'applied',
        receiptKey: 'design-receipt-1'
      })
    })).toBeNull()
  })

  it('reloads the open board then acknowledges the canvas receipt', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => {
      useChatStore.setState({
        blocks: [{
          kind: 'tool',
          id: 'tool-apply',
          turnId: 'turn-1',
          summary: 'apply',
          status: 'success',
          meta: { toolName: 'design_apply_excalidraw', sourceItemKind: 'tool_result' },
          detail: JSON.stringify({
            tool: 'design_apply_excalidraw',
            action: 'apply_excalidraw',
            status: 'accepted',
            receiptKey: 'design-receipt-apply'
          })
        }]
      })
      await vi.waitFor(() => expect(mocks.sendReceipt).toHaveBeenCalledOnce())
    })
    expect(mocks.apply).toHaveBeenCalledWith('/work', 'board-1', '.kun-whiteboards')
    expect(mocks.sendReceipt).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnId: 'turn-1',
      receiptKey: 'design-receipt-apply',
      affectedIds: ['excalidraw:board-1'],
      errors: [],
      generatedFiles: [{
        name: 'excalidraw.png',
        relativePath: '.kun-whiteboards/board-1/excalidraw.png',
        mimeType: 'image/png',
        byteSize: 12
      }]
    })
  })
})
