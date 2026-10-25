import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiController } from '../controller.js'
import { key, keys, typeText } from '../keys.test-support.js'
import { parseTuiKeymapConfig } from '../keymap.js'
import { sanitizeTerminalText } from '../layout.js'
import { PageScrollState, type PageBlock, type PageView } from '../page-model.js'
import { CommandPalettePage } from './command-pages.js'
import { ApprovalPage } from './runtime-pages.js'

const size = { width: 100, height: 40 }

function rows(view: PageView): Array<{ text: string; selected: boolean }> {
  return view.body.flatMap((block: PageBlock) =>
    block.kind === 'row' ? [{ text: sanitizeTerminalText(block.left), selected: block.selected }] : []
  )
}

function sections(view: PageView): string[] {
  return view.body.flatMap((block) => block.kind === 'section' ? [block.label] : [])
}

afterEach(() => { vi.useRealTimers() })

describe('CommandPalettePage', () => {
  it('shows each category section once and filters by search', () => {
    const page = new CommandPalettePage(parseTuiKeymapConfig({}).keymap, vi.fn(), vi.fn())
    const all = sections(page.view({ width: 100, height: 400 }))
    expect(new Set(all).size).toBe(all.length)

    typeText(page, 'rename')
    const filtered = page.view(size)
    expect(rows(filtered).map((row) => row.text)).toContain('Rename session')
  })

  it('runs the highlighted entry on Enter and closes on Escape', () => {
    const close = vi.fn()
    const page = new CommandPalettePage(parseTuiKeymapConfig({}).keymap, close, vi.fn())
    typeText(page, 'thinking')
    page.handleKey(keys.enter)
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ slash: 'thinking' }))
    page.handleKey(keys.escape)
    expect(close).toHaveBeenLastCalledWith()
  })
})

describe('ApprovalPage', () => {
  function approval() {
    const decideApproval = vi.fn(async () => undefined)
    const controller = { state: { projection: undefined }, decideApproval } as unknown as TuiController
    return { page: new ApprovalPage(controller, 'bash', 'Run command: echo hi', vi.fn()), decideApproval }
  }

  it('ignores an Enter typed ahead for the composer, then confirms the highlighted choice', () => {
    vi.useFakeTimers()
    const { page, decideApproval } = approval()
    page.handleKey(keys.enter)
    expect(decideApproval).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    page.handleKey(keys.right)
    expect(rows(page.view(size)).find((row) => row.selected)?.text).toContain('Deny')
    page.handleKey(keys.enter)
    expect(decideApproval).toHaveBeenCalledWith('deny')
  })

  it('allows with y and denies with Escape', async () => {
    const first = approval()
    first.page.handleKey(key('y'))
    expect(first.decideApproval).toHaveBeenCalledWith('allow')
    const second = approval()
    second.page.handleKey(keys.escape)
    expect(second.decideApproval).toHaveBeenCalledWith('deny')
  })

  it('selects with a click and decides on a second click of the same row', () => {
    const { page, decideApproval } = approval()
    page.handleMouse({ type: 'row', index: 1, activate: true })
    expect(decideApproval).not.toHaveBeenCalled()
    page.handleMouse({ type: 'row', index: 1, activate: true })
    expect(decideApproval).toHaveBeenCalledWith('deny')
  })
})

describe('PageScrollState', () => {
  it('follows the tail until the user scrolls up, and resumes at the end', () => {
    const scroll = new PageScrollState()
    scroll.measure(100, 20)
    expect(scroll.offset).toBe(80)
    scroll.scrollBy(-10)
    scroll.measure(120, 20)
    expect(scroll.offset).toBe(70)
    expect(scroll.label()).toBe('71-90/120')
    scroll.scrollTo(1_000)
    scroll.measure(130, 20)
    expect(scroll.offset).toBe(110)
    scroll.measure(5, 20)
    expect(scroll.label()).toBe('5 lines')
  })
})
