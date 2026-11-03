import { describe, expect, it, vi } from 'vitest'
import type { TuiController, TuiControllerState } from '../controller.js'
import { testTuiGraphRun } from '../graph-mode.test-support.js'
import { keys } from '../keys.test-support.js'
import { sanitizeTerminalText } from '../layout.js'
import type { PageView } from '../page-model.js'
import { GraphBoardPage } from './graph-page.js'

function text(view: PageView): string {
  return view.body.map((block) => block.kind === 'line' ? sanitizeTerminalText(block.text) : '').join('\n')
}

function boardPage(width = 120) {
  const run = testTuiGraphRun()
  const controller = { notify: vi.fn() } as unknown as TuiController
  const close = vi.fn()
  const openWorker = vi.fn()
  const page = new GraphBoardPage({
    controller,
    state: { graphRuns: [run] } as unknown as TuiControllerState,
    runId: run.id,
    close,
    openWorker,
    invalidate: vi.fn()
  })
  return { page, run, controller, close, openWorker, size: { width, height: 40 } }
}

describe('GraphBoardPage', () => {
  it('renders the run status, phases, and nodes in a popup frame', () => {
    const { page, size } = boardPage()
    const view = page.view(size)
    expect(view.frame).toBe('popup')
    expect(view.popupTitle).toMatch(/^GRAPH · /u)
    expect(text(view)).toContain('Phase 1 · Implementation')
    expect(text(view)).toContain('accepted')
  })

  it('moves the selection with arrows and closes on Escape', () => {
    const { page, size, close } = boardPage(60)
    page.view(size)
    const first = page.selectedNodeId()
    page.handleKey(keys.down)
    page.view(size)
    expect(page.selectedNodeId()).not.toBe(first)
    page.handleKey(keys.escape)
    expect(close).toHaveBeenCalledOnce()
  })

  it('opens the selected node worker session on Enter', () => {
    const { page, size, run, openWorker } = boardPage()
    page.view(size)
    page.handleKey(keys.enter)
    expect(openWorker).toHaveBeenCalledWith(run.id, page.selectedNodeId(), expect.any(String))
  })
})
