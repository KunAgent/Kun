import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { DesignOpenCard, designOpenCardState } from './DesignOpenCard'

const mocks = vi.hoisted(() => ({
  requestCodeCanvasPanelOpen: vi.fn(),
  openAgentDesignCanvas: vi.fn(async () => true)
}))
vi.mock('../../lib/code-canvas-panel-event', () => ({
  requestCodeCanvasPanelOpen: mocks.requestCodeCanvasPanelOpen
}))
vi.mock('../../design/agent-design-ingest', () => ({
  openAgentDesignCanvas: mocks.openAgentDesignCanvas
}))

const REQUEST_ID = 'design_0123456789abcdef'
const DOCUMENT_ID = '0a1b2c3d'

function block(designOpenRequest: Record<string, unknown>, id = 'tool_design'): ToolBlock {
  return {
    kind: 'tool',
    id,
    turnId: 'turn-1',
    summary: 'design_open',
    status: 'success',
    toolKind: 'file_change',
    meta: { toolName: 'design_open', designOpenRequest }
  } as unknown as ToolBlock
}

const readyRequest = {
  status: 'ready',
  requestId: REQUEST_ID,
  title: 'Footer entry',
  documentId: DOCUMENT_ID,
  target: 'web',
  screenCount: 1,
  screens: [{
    artifactId: '9f8e7d6c',
    name: 'Footer',
    relativePath: `.kun-design/${DOCUMENT_ID}/9f8e7d6c/v1.html`,
    width: 1280,
    height: 800
  }]
}

function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thread-1',
    title: 'Code task',
    updatedAt: '2026-10-24T00:00:00.000Z',
    model: '',
    mode: 'agent',
    workspace: '/workspace',
    agentSurface: 'code',
    ...overrides
  }
}

async function render(
  request: Record<string, unknown> | ToolBlock[],
  requestTurnLive = false
): Promise<ReactTestRenderer> {
  const blocks = Array.isArray(request) ? request : [block(request)]
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(DesignOpenCard, { blocks, threadId: 'thread-1', requestTurnLive }))
  })
  return renderer
}

function screen(artifactId: string, name: string, section?: string) {
  return {
    artifactId,
    name,
    relativePath: `.kun-design/${DOCUMENT_ID}/${artifactId}/v1.html`,
    width: 1280,
    height: 800,
    ...(section ? { section } : {})
  }
}

function card(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => node.type === 'button' && node.props['data-design-open-card'] !== undefined)
}

function cardText(renderer: ReactTestRenderer): string {
  return card(renderer).findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join('')).join(' | ')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useChatStore.setState({ threads: [thread()] })
  useCodeCanvasDesignSurface.getState().clearDesignSurface()
})

afterEach(() => {
  mocks.requestCodeCanvasPanelOpen.mockClear()
  mocks.openAgentDesignCanvas.mockClear()
})

describe('DesignOpenCard', () => {
  it('opens a finished design on the canvas with one click', async () => {
    const renderer = await render(readyRequest)
    expect(card(renderer).props['data-design-open-state']).toBe('ready')
    expect(card(renderer).props.disabled).toBe(false)
    expect(cardText(renderer)).toBe('Footer entry | 1 board · Web')
    await act(async () => card(renderer).props.onClick())
    expect(mocks.openAgentDesignCanvas).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      workspaceRoot: '/workspace',
      request: expect.objectContaining({ documentId: DOCUMENT_ID, status: 'ready' })
    }))
    await act(async () => renderer.unmount())
  })

  it('shows progress while the agent is still writing the screens, with nothing to click', async () => {
    const renderer = await render({ status: 'pending', title: 'Footer entry', screenCount: 2 }, true)
    expect(card(renderer).props['data-design-open-state']).toBe('designing')
    expect(card(renderer).props.disabled).toBe(true)
    expect(cardText(renderer)).toBe('Footer entry | Designing on the canvas… · 2 boards')
    await act(async () => renderer.unmount())
  })

  it('stops spinning when the reply ended before the design was written', () => {
    const pending = { status: 'pending' as const, title: 'X', screenCount: 1, screens: [] }
    expect(designOpenCardState(pending, true)).toBe('designing')
    expect(designOpenCardState(pending, false)).toBe('interrupted')
  })

  it('shows one card for a design built across several calls, opening every board', async () => {
    const first = block({ ...readyRequest, screens: [screen('11111111', 'Overview', '01 Flow')], screenCount: 1 }, 'call-1')
    const second = block({
      ...readyRequest,
      requestId: 'design_fedcba9876543210',
      screens: [screen('22222222', 'Dark', '02 Themes'), screen('11111111', 'Overview v2', '01 Flow')],
      screenCount: 2
    }, 'call-2')
    const third = block({ status: 'pending', title: 'Footer entry', screenCount: 3 }, 'call-3')
    const live = await render([first, second, third], true)
    expect(cardText(live)).toBe('Footer entry | Designing on the canvas… · 5 boards')
    await act(async () => live.unmount())

    const settled = await render([first, second, third], false)
    expect(card(settled).props['data-design-open-state']).toBe('ready')
    expect(cardText(settled)).toBe('Footer entry | 2 boards · Web')
    await act(async () => card(settled).props.onClick())
    const opened = mocks.openAgentDesignCanvas.mock.calls[0] as unknown as [{ request: { status: string; screens: { name: string }[] } }]
    expect(opened[0].request.status).toBe('ready')
    expect(opened[0].request.screens.map((item) => item.name)).toEqual(['Overview v2', 'Dark'])
    await act(async () => settled.unmount())
  })

  it('reports a failed call inline', async () => {
    const renderer = await render({ status: 'failed', title: 'Footer entry', error: 'screen "A" needs html' })
    expect(card(renderer).props['data-design-open-state']).toBe('failed')
    expect(cardText(renderer)).toContain('screen "A" needs html')
    expect(card(renderer).props.disabled).toBe(true)
    await act(async () => renderer.unmount())
  })

  it('reopens the bound document of an old queued request without a start button', async () => {
    useChatStore.setState({
      threads: [thread({
        designProfile: { documentTarget: { documentId: 'legacydoc', boardArtifactId: 'board-1' } }
      } as unknown as Partial<NormalizedThread>)]
    })
    const renderer = await render({ status: 'legacy', requestId: REQUEST_ID, title: 'Footer entry' })
    expect(card(renderer).props['data-design-open-state']).toBe('legacy')
    expect(renderer.root.findAll((node) => node.props['data-design-open-start'] !== undefined)).toHaveLength(0)
    await act(async () => card(renderer).props.onClick())
    expect(useCodeCanvasDesignSurface.getState().surface).toMatchObject({
      threadId: 'thread-1',
      documentId: 'legacydoc',
      boardArtifactId: 'board-1'
    })
    expect(mocks.requestCodeCanvasPanelOpen).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })
})
