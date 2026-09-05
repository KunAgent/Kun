import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { type WorkWhiteboard, useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkbenchPptWhiteboardRouter } from './useWorkbenchPptWhiteboardRouter'

type FindPptBoardInput = Parameters<ReturnType<typeof useWriteWorkspaceStore.getState>['findOrCreatePptWhiteboard']>[0]
const originalFindOrCreatePptWhiteboard = useWriteWorkspaceStore.getState().findOrCreatePptWhiteboard
const originalUpdateWhiteboardPptState = useWriteWorkspaceStore.getState().updateWhiteboardPptState

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function directionBundle(workflowId: string) {
  return {
    schemaVersion: 1, workflowId, childId: `child-${workflowId}`,
    manifestPath: 'deck/.kun-ppt-review/manifest.json', previewMode: 'image-first',
    deckTitle: 'Direction deck', phase: 'awaiting_direction', recommendedDirectionId: 'signal',
    slides: [{ slideId: 'slide-1', index: 0, title: 'Opening' }],
    directions: ['editorial', 'signal', 'warm'].map((directionId, index) => ({
      directionId, name: `${directionId} direction`,
      rationale: `A distinct ${directionId} visual direction for this presentation.`,
      revision: index + 1, recommended: directionId === 'signal',
      fonts: [`Display ${index}`, `Body ${index}`],
      colors: ['#0F172A', '#F8FAFC', '#22C55E', '#F59E0B'],
      layout: `${index + 2}-column grid`, background: 'solid', imagery: 'editorial photography',
      previews: ['cover', 'representative', 'complex'].map((role) => ({
        role, imagePath: `.kun/images/${directionId}-${role}.png`
      }))
    }))
  }
}

function tool(id: string, detail: Record<string, unknown>): ChatBlock {
  return {
    kind: 'tool', id, summary: 'PPT', status: 'success',
    meta: { toolName: 'ppt_agent' }, detail: JSON.stringify(detail)
  }
}

const activeThread: NormalizedThread = {
  id: 'thread-a', title: 'PPT', updatedAt: '2026-08-13T00:00:00.000Z',
  model: 'deepseek-v4-pro', mode: 'agent', workspace: '/work', status: 'running',
  agentSurface: 'write'
}

function RouterHarness({ blocks }: { blocks: ChatBlock[] }): null {
  useWorkbenchPptWhiteboardRouter({
    activeThreadId: activeThread.id,
    blocks,
    route: 'write',
    threads: [activeThread],
    workspaceRoot: '/work'
  })
  return null
}

describe('useWorkbenchPptWhiteboardRouter', () => {
  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    useWriteWorkspaceStore.setState({
      findOrCreatePptWhiteboard: originalFindOrCreatePptWhiteboard,
      updateWhiteboardPptState: originalUpdateWhiteboardPptState
    })
  })

  it('opens every recovered PPT board without committing phase before canvas projection', async () => {
    const findOrCreatePptWhiteboard = vi.fn(async (input: FindPptBoardInput) => ({
      id: `board-${input.workflowId}`, title: 'Review', workspaceRoot: '/work',
      threadId: input.threadId, workflowId: input.workflowId, childId: input.childId,
      phase: 'blank' as const, revision: 0,
      createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z'
    }))
    const updateWhiteboardPptState = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      findOrCreatePptWhiteboard,
      updateWhiteboardPptState
    })
    const blocks = [
      tool('direction-a', { directionBundle: directionBundle('workflow-a') }),
      tool('direction-b', { directionBundle: directionBundle('workflow-b') })
    ]

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(findOrCreatePptWhiteboard).toHaveBeenCalledTimes(2))

    expect(findOrCreatePptWhiteboard.mock.calls.map(([input]) => input.workflowId)).toEqual([
      'workflow-a', 'workflow-b'
    ])
    expect(findOrCreatePptWhiteboard.mock.calls.map(([input]) => input.title)).toEqual([
      'Direction deck', 'Direction deck'
    ])
    expect(updateWhiteboardPptState).not.toHaveBeenCalled()
    await act(async () => renderer?.unmount())
  })

  it('passes the main agent UI title into the canonical board creation', async () => {
    const findOrCreatePptWhiteboard = vi.fn(async (input: FindPptBoardInput) => ({
      id: 'board-workflow-a', title: input.title, workspaceRoot: '/work',
      threadId: input.threadId, workflowId: input.workflowId, childId: input.childId,
      phase: 'blank' as const, revision: 0,
      createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z'
    }))
    const updateWhiteboardPptState = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      findOrCreatePptWhiteboard,
      updateWhiteboardPptState
    })
    const blocks = [tool('direction-a', {
      title: 'Text completion landscape',
      directionBundle: directionBundle('workflow-a')
    })]

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(findOrCreatePptWhiteboard).toHaveBeenCalledTimes(1))

    expect(findOrCreatePptWhiteboard).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Text completion landscape'
    }))
    expect(updateWhiteboardPptState).not.toHaveBeenCalled()
    await act(async () => renderer?.unmount())
  })

  it('does not update a board when its async route finishes after a workspace switch', async () => {
    const pendingBoard = deferred<WorkWhiteboard>()
    const findOrCreatePptWhiteboard = vi.fn(() => pendingBoard.promise)
    const updateWhiteboardPptState = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      findOrCreatePptWhiteboard,
      updateWhiteboardPptState
    })
    const blocks = [tool('direction-a', { directionBundle: directionBundle('workflow-a') })]

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(findOrCreatePptWhiteboard).toHaveBeenCalledTimes(1))

    useWriteWorkspaceStore.setState({ workspaceRoot: '/other-workspace' })
    pendingBoard.resolve({
      id: 'board-workflow-a', title: 'Review', workspaceRoot: '/work',
      threadId: 'thread-a', workflowId: 'workflow-a', childId: 'child-workflow-a',
      phase: 'directions', revision: 3,
      createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z'
    })
    await act(async () => { await Promise.resolve() })

    expect(updateWhiteboardPptState).not.toHaveBeenCalled()
    await act(async () => renderer?.unmount())
  })

  it('commits a validated completed artifact that has no pending canvas projection', async () => {
    const findOrCreatePptWhiteboard = vi.fn(async (input: FindPptBoardInput) => ({
      id: 'board-workflow-a', title: input.title, workspaceRoot: '/work',
      threadId: input.threadId, workflowId: input.workflowId, childId: input.childId,
      phase: 'review' as const, revision: 2,
      createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z'
    }))
    const updateWhiteboardPptState = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work', findOrCreatePptWhiteboard, updateWhiteboardPptState
    })
    const blocks = [tool('complete-a', {
      phase: 'completed', workflowId: 'workflow-a', childId: 'child-workflow-a',
      deckArtifact: { output: 'presentations/final.pptx' }
    })]

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    await vi.waitFor(() => expect(updateWhiteboardPptState).toHaveBeenCalledWith(
      'board-workflow-a', expect.objectContaining({
        phase: 'complete', outputPath: 'presentations/final.pptx'
      })
    ))
    await act(async () => renderer?.unmount())
  })

  it('ignores a completed payload without a governed deck artifact', async () => {
    const findOrCreatePptWhiteboard = vi.fn()
    const updateWhiteboardPptState = vi.fn()
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work', findOrCreatePptWhiteboard, updateWhiteboardPptState
    })
    const blocks = [tool('complete-a', {
      phase: 'completed', workflowId: 'workflow-a', childId: 'child-workflow-a'
    })]

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(RouterHarness, { blocks })) })
    expect(findOrCreatePptWhiteboard).not.toHaveBeenCalled()
    expect(updateWhiteboardPptState).not.toHaveBeenCalled()
    await act(async () => renderer?.unmount())
  })
})
