import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  claimExcalidrawApplyRequest,
  clearExcalidrawApplyHandlersForTests,
  excalidrawApplyKey,
  registerExcalidrawApplyHandler
} from '../../whiteboard/excalidraw-apply'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { WorkWhiteboard } from '../../write/write-workspace-store-types'
import { useWorkbenchExcalidrawRouter } from './useWorkbenchExcalidrawRouter'

const mocks = vi.hoisted(() => ({
  sendReceipt: vi.fn(),
  apply: vi.fn()
}))

vi.mock('../../design/canvas/canvas-receipt-sender', () => ({
  sendCanvasTurnReceipt: (...args: unknown[]) => mocks.sendReceipt(...args)
}))

vi.mock('../../whiteboard/excalidraw-apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../whiteboard/excalidraw-apply')>()
  return {
    ...actual,
    applyOpenExcalidrawScene: (...args: unknown[]) => mocks.apply(...args)
  }
})

type EnsureInput = Parameters<
  ReturnType<typeof useWriteWorkspaceStore.getState>['findOrCreateExcalidrawWhiteboard']
>[0]
const originalFindOrCreate = useWriteWorkspaceStore.getState().findOrCreateExcalidrawWhiteboard

const activeThread: NormalizedThread = {
  id: 'thread-a', title: 'Work', updatedAt: '2026-08-13T00:00:00.000Z',
  model: 'deepseek-v4-pro', mode: 'agent', workspace: '/work', status: 'running',
  agentSurface: 'write'
}

function board(id: string): WorkWhiteboard {
  return {
    id, title: id, workspaceRoot: '/work', threadId: 'thread-a', threadIds: ['thread-a'],
    engine: 'excalidraw', phase: 'blank', revision: 0,
    createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z'
  }
}

function tool(id: string, detail: Record<string, unknown>): ChatBlock {
  return {
    kind: 'tool', id, turnId: 'turn-1', summary: 'x', status: 'success',
    meta: { sourceItemKind: 'tool_result' }, detail: JSON.stringify(detail)
  }
}

function RouterHarness({ blocks, route = 'write' }: { blocks: ChatBlock[]; route?: 'write' | 'chat' }): null {
  useWorkbenchExcalidrawRouter({
    activeThreadId: activeThread.id,
    blocks,
    route,
    threads: [activeThread],
    workspaceRoot: '/work'
  })
  return null
}

describe('useWorkbenchExcalidrawRouter', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.sendReceipt.mockClear()
    mocks.apply.mockReset()
    mocks.apply.mockResolvedValue({
      ok: true,
      pngRelativePath: '.kun-whiteboards/auth-flow/excalidraw.png',
      pngByteSize: 7,
      elementCount: 3
    })
    clearExcalidrawApplyHandlersForTests()
    useChatStore.setState({
      activeThreadId: 'thread-a',
      currentTurnId: 'turn-1',
      blocks: []
    })
    useWriteWorkspaceStore.setState({ workspaceRoot: '/work' })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    clearExcalidrawApplyHandlersForTests()
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: originalFindOrCreate })
    vi.unstubAllGlobals()
  })

  it('opens or creates the requested board and acknowledges the receipt', async () => {
    const findOrCreate = vi.fn(async (input: EnsureInput) => {
      registerExcalidrawApplyHandler(
        excalidrawApplyKey('/work', 'auth-flow', '.kun-whiteboards'),
        async () => ({ ok: true as const, pngRelativePath: 'x', pngByteSize: 1, elementCount: 1 })
      )
      return { ok: true as const, board: board(input.boardId ?? 'auth-flow'), created: true }
    })
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    const blocks = [tool('open-1', {
      tool: 'design_open_excalidraw', action: 'open_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-open', boardId: 'auth-flow', title: 'Auth flow'
    })]

    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(mocks.sendReceipt).toHaveBeenCalledOnce())

    expect(findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/work', boardId: 'auth-flow', title: 'Auth flow', threadId: 'thread-a'
    }))
    expect(mocks.sendReceipt).toHaveBeenCalledWith({
      threadId: 'thread-a', turnId: 'turn-1', receiptKey: 'design-receipt-open',
      affectedIds: ['excalidraw:auth-flow'], errors: []
    })
  })

  it('applies to a board that had to be opened first and reports the PNG sidecar', async () => {
    const findOrCreate = vi.fn(async (input: EnsureInput) => {
      registerExcalidrawApplyHandler(
        excalidrawApplyKey('/work', input.boardId ?? 'auth-flow', '.kun-whiteboards'),
        async () => ({ ok: true as const, pngRelativePath: 'x', pngByteSize: 1, elementCount: 1 })
      )
      return { ok: true as const, board: board(input.boardId ?? 'auth-flow'), created: true }
    })
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    const blocks = [tool('apply-1', {
      tool: 'design_apply_excalidraw', action: 'apply_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-apply', boardId: 'auth-flow'
    })]

    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(mocks.sendReceipt).toHaveBeenCalledOnce())

    expect(mocks.apply).toHaveBeenCalledWith('/work', 'auth-flow', '.kun-whiteboards')
    expect(mocks.sendReceipt).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-a', turnId: 'turn-1', receiptKey: 'design-receipt-apply',
      affectedIds: ['excalidraw:auth-flow'], errors: [],
      generatedFiles: [{
        name: 'excalidraw.png',
        relativePath: '.kun-whiteboards/auth-flow/excalidraw.png',
        mimeType: 'image/png',
        byteSize: 7
      }]
    }))
  })

  it('defers an apply request to a board that is already mounted', async () => {
    const findOrCreate = vi.fn()
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    registerExcalidrawApplyHandler(
      excalidrawApplyKey('/work', 'auth-flow', '.kun-whiteboards'),
      async () => ({ ok: true, pngRelativePath: 'x', pngByteSize: 1, elementCount: 1 })
    )
    const blocks = [tool('apply-2', {
      tool: 'design_apply_excalidraw', action: 'apply_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-defer', boardId: 'auth-flow'
    })]

    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await act(async () => { await Promise.resolve() })

    expect(findOrCreate).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.sendReceipt).not.toHaveBeenCalled()
  })

  it('skips a block already claimed by a mounted board hook', async () => {
    const findOrCreate = vi.fn()
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    const blocks = [tool('apply-3', {
      tool: 'design_apply_excalidraw', action: 'apply_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-claimed', boardId: 'unmounted-board'
    })]
    expect(claimExcalidrawApplyRequest('apply-3')).toBe(true)

    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await act(async () => { await Promise.resolve() })

    expect(findOrCreate).not.toHaveBeenCalled()
    expect(mocks.sendReceipt).not.toHaveBeenCalled()
  })

  it('receipts a structured failure when the board cannot switch engines', async () => {
    const findOrCreate = vi.fn(async () => ({
      ok: false as const, code: 'engine_locked' as const, board: board('locked-board')
    }))
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    const blocks = [tool('open-locked', {
      tool: 'design_open_excalidraw', action: 'open_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-locked', boardId: 'locked-board'
    })]

    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(mocks.sendReceipt).toHaveBeenCalledOnce())

    expect(mocks.sendReceipt).toHaveBeenCalledWith(expect.objectContaining({
      affectedIds: [],
      errors: [expect.objectContaining({ code: 'EXCALIDRAW_ENGINE_LOCKED' })]
    }))
  })

  it('ignores requests on a non-Work surface thread', async () => {
    const findOrCreate = vi.fn()
    useWriteWorkspaceStore.setState({ findOrCreateExcalidrawWhiteboard: findOrCreate })
    const codeThread: NormalizedThread = { ...activeThread, id: 'thread-code', agentSurface: 'code' }
    const blocks = [tool('open-code', {
      tool: 'design_open_excalidraw', action: 'open_excalidraw', status: 'accepted',
      receiptKey: 'design-receipt-code', boardId: 'auth-flow'
    })]

    function CodeHarness(): null {
      useWorkbenchExcalidrawRouter({
        activeThreadId: codeThread.id,
        blocks,
        route: 'chat',
        threads: [codeThread],
        workspaceRoot: '/work'
      })
      return null
    }
    await act(async () => { renderer = create(createElement(CodeHarness)) })
    await act(async () => { await Promise.resolve() })

    expect(findOrCreate).not.toHaveBeenCalled()
    expect(mocks.sendReceipt).not.toHaveBeenCalled()
  })
})
