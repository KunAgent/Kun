import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { PptDeckCards } from './PptDeckCard'
import { latestPptDeckCards, readPptDeckCard } from './ppt-deck-card-model'

const sendMessage = vi.fn(async () => true)
const openWorkspaceFileInSystem = vi.fn(async () => ({ ok: true }))
const revealWorkspaceFileInFolder = vi.fn(async () => ({ ok: true }))
const requestCodeCanvasPanelOpen = vi.fn()
let storeBlocks: ChatBlock[] = []
let busy = false

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ blocks: storeBlocks, busy, sendMessage, workspaceRoot: '/work' })
}))

vi.mock('../../lib/code-canvas-panel-event', () => ({
  requestCodeCanvasPanelOpen: (detail: unknown) => requestCodeCanvasPanelOpen(detail)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})` : key
  })
}))

function deckBlock(id: string, toolName: 'ppt_preview' | 'ppt_export', output: Record<string, unknown>, status: ToolBlock['status'] = 'success'): ToolBlock {
  return { kind: 'tool', id, summary: toolName, status, detail: JSON.stringify(output), meta: { toolName } }
}

const reviewBundle = {
  workflowId: 'deck:presentations/q3',
  childId: 'thr_main',
  manifestPath: 'presentations/q3/.kun-ppt-review/preview.json',
  deckTitle: 'Q3 review',
  styleFingerprint: 'abc',
  phase: 'awaiting_review',
  slides: [
    { slideId: 'pages/01_cover.page', index: 0, title: 'Cover', revision: 2, status: 'ready', assets: [{ path: 'presentations/q3/media/line.png', origin: 'user' }] },
    { slideId: 'pages/02_risks.page', index: 1, title: 'Risks', revision: 1, status: 'ready' }
  ]
}

const preview = deckBlock('p1', 'ppt_preview', {
  deck: 'presentations/q3', deckTitle: 'Q3 review', pageCount: 2, changedPages: [1],
  imageAssets: 'unavailable', issues: [{ page: 2, rule: 'small-text', message: 'tiny' }], reviewBundle
})

const exported = deckBlock('e1', 'ppt_export', {
  deck: 'presentations/q3', output: 'presentations/q3.pptx', slides: 2, editableSlides: 2,
  validated: true, phase: 'completed', qa: { counts: { errors: 0, warnings: 1 } },
  reviewBundle: { ...reviewBundle, phase: 'completed' }
})

function render(blocks: ChatBlock[]): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(PptDeckCards, { blocks }))
  })
  return renderer
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

afterEach(() => {
  storeBlocks = []
  busy = false
  sendMessage.mockClear()
  requestCodeCanvasPanelOpen.mockClear()
  vi.unstubAllGlobals()
})

describe('ppt deck card model', () => {
  it('reads a review preview with image origins and lint hints', () => {
    expect(readPptDeckCard(preview)).toMatchObject({
      deck: 'presentations/q3',
      phase: 'review',
      pageCount: 2,
      revision: 2,
      imageAssets: 'unavailable',
      images: { user: 1, generated: 0, project: 0, nativeSlides: 1 },
      lintIssues: 1
    })
  })

  it('reads directions, failed QA, and validated exports', () => {
    const directions = deckBlock('d1', 'ppt_preview', {
      deck: 'presentations/q3',
      directionBundle: {
        workflowId: 'deck:presentations/q3', childId: 'thr_main', deckTitle: 'Q3',
        slides: [{ slideId: 'a:1' }, { slideId: 'a:2' }, { slideId: 'a:3' }],
        directions: [{ name: 'Calm', recommended: true, revision: 1 }, { name: 'Bold', revision: 1 }, { name: 'Paper', revision: 1 }]
      }
    })
    expect(readPptDeckCard(directions)).toMatchObject({ phase: 'directions', directions: { count: 3, recommendedName: 'Calm' } })
    const failed = deckBlock('f1', 'ppt_export', {
      deck: 'presentations/q3', validated: false, phase: 'failed_recoverable',
      qa: { counts: { errors: 2, warnings: 0 } }, reviewBundle: { ...reviewBundle, phase: 'failed_recoverable' }
    }, 'error')
    expect(readPptDeckCard(failed)).toMatchObject({ phase: 'qa_failed', qa: { errors: 2, warnings: 0 } })
    expect(readPptDeckCard(exported)).toMatchObject({ phase: 'exported', pptx: { output: 'presentations/q3.pptx', slides: 2, editableSlides: 2 } })
  })

  it('keeps only the latest call per deck', () => {
    expect(latestPptDeckCards([preview, exported]).map((card) => card.blockId)).toEqual(['e1'])
  })
})

describe('PptDeckCards', () => {
  it('opens the whiteboard and asks the agent to export a reviewed deck', () => {
    storeBlocks = [preview]
    const renderer = render([preview])
    const output = text(renderer)
    expect(output).toContain('pptDeckStateReview')
    expect(output).toContain('pptDeckAssetUser(n=1)')
    expect(output).toContain('pptDeckNativeSlides(n=1)')
    expect(output).toContain('pptDeckLint(n=1)')

    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-deck-open-board' }).props.onClick())
    expect(requestCodeCanvasPanelOpen).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'ppt-review', blockId: 'p1', workflowId: 'deck:presentations/q3', childId: 'thr_main'
    }))
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-deck-export' }).props.onClick())
    expect(sendMessage).toHaveBeenCalledWith('pptDeckExportMessage', 'agent')
  })

  it('hides the export action once a later call touched the deck or the turn is busy', () => {
    storeBlocks = [preview, exported]
    expect(render([preview]).root.findAllByProps({ 'data-testid': 'ppt-deck-export' })).toHaveLength(0)
    storeBlocks = [preview]
    busy = true
    expect(render([preview]).root.findAllByProps({ 'data-testid': 'ppt-deck-export' })).toHaveLength(0)
  })

  it('opens or reveals a validated export', () => {
    vi.stubGlobal('window', { kunGui: { openWorkspaceFileInSystem, revealWorkspaceFileInFolder } })
    storeBlocks = [exported]
    const renderer = render([exported])
    expect(text(renderer)).toContain('pptDeckPptxMeta(n=2,editable=2)')
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-deck-open' }).props.onClick())
    act(() => renderer.root.findByProps({ 'data-testid': 'ppt-deck-reveal' }).props.onClick())
    expect(openWorkspaceFileInSystem).toHaveBeenCalledWith({ path: 'presentations/q3.pptx', workspaceRoot: '/work' })
    expect(revealWorkspaceFileInFolder).toHaveBeenCalledWith({ path: 'presentations/q3.pptx', workspaceRoot: '/work' })
  })
})
