import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useAgentDesignRequestStore } from '../../design/agent-design-requests'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { DesignOpenCard } from './DesignOpenCard'

const panelMocks = vi.hoisted(() => ({ requestCodeCanvasPanelOpen: vi.fn() }))
vi.mock('../../lib/code-canvas-panel-event', () => ({
  requestCodeCanvasPanelOpen: panelMocks.requestCodeCanvasPanelOpen
}))

const REQUEST_ID = 'design_0123456789abcdef'

const block = {
  kind: 'tool',
  id: 'tool_design',
  turnId: 'turn-1',
  summary: 'design_open',
  status: 'success',
  toolKind: 'file_change',
  meta: {
    toolName: 'design_open',
    designOpenRequest: {
      status: 'queued',
      requestId: REQUEST_ID,
      title: 'Footer entry',
      brief: 'Move the update button.',
      target: 'web'
    }
  }
} as unknown as ToolBlock

function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thread-1',
    title: 'Code task',
    updatedAt: '2026-10-20T00:00:00.000Z',
    model: '',
    mode: 'agent',
    workspace: '/workspace',
    agentSurface: 'code',
    ...overrides
  }
}

describe('DesignOpenCard', () => {
  let renderer: ReactTestRenderer | null = null

  async function render(requestTurnLive = false): Promise<ReactTestRenderer> {
    await act(async () => {
      renderer = create(createElement(DesignOpenCard, { block, threadId: 'thread-1', requestTurnLive }))
    })
    return renderer!
  }

  function section(): { props: Record<string, unknown> } {
    return renderer!.root.find((node) => node.type === 'section' && node.props['data-design-open-card'] !== undefined)
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    panelMocks.requestCodeCanvasPanelOpen.mockClear()
    useAgentDesignRequestStore.setState({ records: {}, manualStarts: [] })
    useCodeCanvasDesignSurface.setState({ surface: null })
    useDesignWorkspaceStore.setState({ documents: [] })
    useChatStore.setState({ busy: false, threads: [thread()] })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount())
    renderer = null
  })

  it('tells the user the pass starts after the live reply', async () => {
    await render(true)
    expect(section().props['data-design-open-state']).toBe('queued')
    expect(JSON.stringify(renderer!.toJSON())).toContain('Starts when this reply finishes')
  })

  it('offers a manual start for a request that never ran', async () => {
    await render(false)
    expect(section().props['data-design-open-state']).toBe('not-started')
    const start = renderer!.root.find((node) => node.type === 'button' && node.props['data-design-open-start'] !== undefined)
    act(() => start.props.onClick())
    expect(useAgentDesignRequestStore.getState().manualStarts).toEqual([REQUEST_ID])
  })

  it('opens the bound Design canvas with its screen count once ready', async () => {
    useChatStore.setState({
      threads: [thread({
        designProfile: {
          version: 1,
          documentTarget: { documentId: 'doc-1', boardArtifactId: 'board-1' },
          outputMedium: 'html',
          target: 'web',
          preset: 'none',
          context: { tone: [] },
          lockedAtTurnId: 'turn-2'
        }
      })]
    })
    useDesignWorkspaceStore.setState({
      documents: [{
        id: 'doc-1',
        title: 'Footer entry redesign',
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
        order: 0,
        activeArtifactId: null,
        artifacts: [
          { id: 'a', kind: 'html', title: 'A' },
          { id: 'b', kind: 'html', title: 'B' },
          { id: 'board-1', kind: 'canvas', title: 'Board' }
        ]
      }]
    } as never)
    await render(false)
    expect(section().props['data-design-open-state']).toBe('ready')
    const json = JSON.stringify(renderer!.toJSON())
    expect(json).toContain('Footer entry redesign')
    expect(json).toContain('2 screens')
    const open = renderer!.root.find((node) => node.type === 'button' && node.props['data-design-open-open'] !== undefined)
    act(() => open.props.onClick())
    expect(useCodeCanvasDesignSurface.getState().surface).toMatchObject({
      threadId: 'thread-1',
      workspaceRoot: '/workspace',
      documentId: 'doc-1',
      boardArtifactId: 'board-1'
    })
    expect(panelMocks.requestCodeCanvasPanelOpen).toHaveBeenCalledTimes(1)
  })

  it('shows a designing state while the dispatched pass runs', async () => {
    useAgentDesignRequestStore.getState().setPhase(REQUEST_ID, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'running'
    })
    useChatStore.setState({ busy: true })
    await render(false)
    expect(section().props['data-design-open-state']).toBe('designing')
  })
})
