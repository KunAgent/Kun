import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TFunction } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { PptAgentProgressPanel } from './PptAgentProgressPanel'

const sendMessage = vi.fn(async () => true)
const openWorkspaceFileInSystem = vi.fn(async () => ({ ok: true }))
const revealWorkspaceFileInFolder = vi.fn(async () => ({ ok: true }))
let storeBlocks: ChatBlock[] = []
let busy = false

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ blocks: storeBlocks, busy, sendMessage, workspaceRoot: '/work' })
}))

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})` : key
) as unknown as TFunction<'common'>

function pptBlock(id: string, output: Record<string, unknown>, action?: string): ToolBlock {
  return {
    kind: 'tool',
    id,
    summary: 'ppt_agent',
    status: 'success',
    detail: JSON.stringify(output),
    meta: { toolName: 'ppt_agent', ...(action ? { action } : {}) }
  }
}

function render(block: ToolBlock, status = 'done'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(PptAgentProgressPanel, { block, status, t }))
  })
  return renderer
}

function stepStates(renderer: ReactTestRenderer): Record<string, string> {
  return Object.fromEntries(renderer.root.findAll((node) => node.type === 'li')
    .map((node) => [node.props['data-step'], node.props['data-state']]))
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

const review = pptBlock('b1', {
  workflowId: 'ppt_1',
  childId: 'child_1',
  phase: 'awaiting_review',
  imageAssets: 'unavailable',
  reviewBundle: {
    slides: [
      { slideId: 's1', assets: [{ path: 'deck/media/line.png', origin: 'user' }] },
      { slideId: 's2' }
    ]
  }
})

afterEach(() => {
  storeBlocks = []
  busy = false
  sendMessage.mockClear()
  vi.unstubAllGlobals()
})

describe('PptAgentProgressPanel', () => {
  it('shows the review step waiting, image origins, and approval for the latest call', () => {
    storeBlocks = [review]
    const renderer = render(review)
    expect(stepStates(renderer)).toEqual({
      plan: 'done', direction: 'skipped', build: 'done', preview: 'done', review: 'waiting', export: 'todo'
    })
    const output = text(renderer)
    expect(output).toContain('pptProgressPreviews(n=2)')
    expect(output).toContain('pptProgressAssetUser(n=1)')
    expect(output).toContain('pptProgressNativeSlides(n=1)')
    expect(output).toContain('pptProgressImageAssetsUnavailable')

    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-agent-approve' }).props.onClick({ stopPropagation: () => undefined }))
    expect(sendMessage).toHaveBeenCalledWith('pptProgressApproveMessage', 'agent')
  })

  it('hides follow-up actions once a later call continued the workflow or the turn is busy', () => {
    storeBlocks = [review, pptBlock('b2', { action: 'approve_and_build', childId: 'child_1', workflowId: 'ppt_1' }, 'approve_and_build')]
    expect(render(review).root.findAllByProps({ 'data-testid': 'ppt-agent-approve' })).toHaveLength(0)
    storeBlocks = [review]
    busy = true
    expect(render(review).root.findAllByProps({ 'data-testid': 'ppt-agent-approve' })).toHaveLength(0)
  })

  it('offers the recommended direction while directions wait for a choice', () => {
    const directions = pptBlock('d1', {
      workflowId: 'ppt_2', childId: 'child_2', phase: 'awaiting_direction',
      directionBundle: { directions: [{ name: 'Calm', recommended: true }, { name: 'Bold' }] }
    })
    storeBlocks = [directions]
    const renderer = render(directions)
    expect(stepStates(renderer)).toMatchObject({ plan: 'done', direction: 'waiting' })
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-agent-use-recommended' }).props.onClick({ stopPropagation: () => undefined }))
    expect(sendMessage).toHaveBeenCalledWith('pptProgressUseRecommendedMessage(name=Calm)', 'agent')
  })

  it('opens or reveals the exported deck from a completed approval', () => {
    vi.stubGlobal('window', { kunGui: { openWorkspaceFileInSystem, revealWorkspaceFileInFolder } })
    const completed = pptBlock('c1', {
      workflowId: 'ppt_1', phase: 'completed',
      deckArtifact: { output: 'presentations/q3.pptx', slides: 12, editableSlides: 12, validated: true }
    }, 'approve_and_build')
    storeBlocks = [completed]
    const renderer = render(completed)
    expect(Object.values(stepStates(renderer)).filter((state) => state === 'done')).toHaveLength(5)
    expect(text(renderer)).toContain('pptProgressDeckMeta(n=12,editable=12)')
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-agent-open-deck' }).props.onClick({ stopPropagation: () => undefined }))
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-agent-reveal-deck' }).props.onClick({ stopPropagation: () => undefined }))
    expect(openWorkspaceFileInSystem).toHaveBeenCalledWith({ path: 'presentations/q3.pptx', workspaceRoot: '/work' })
    expect(revealWorkspaceFileInFolder).toHaveBeenCalledWith({ path: 'presentations/q3.pptx', workspaceRoot: '/work' })
  })

  it('tracks a running start from the child tool it is calling', () => {
    const running: ToolBlock = {
      kind: 'tool', id: 'r1', summary: 'ppt_agent', status: 'running',
      detail: JSON.stringify({ action: 'start', title: 'Deck' }),
      meta: { toolName: 'ppt_agent', action: 'start', child: { activity: { phase: 'tool', label: 'Rendering', toolName: 'ppt_generate_previews' } } }
    }
    expect(stepStates(render(running, 'running'))).toMatchObject({
      plan: 'done', direction: 'skipped', build: 'done', preview: 'current', review: 'todo'
    })
  })
})
