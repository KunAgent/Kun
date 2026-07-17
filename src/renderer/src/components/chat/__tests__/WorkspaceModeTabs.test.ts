import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  function props(activeView: 'chat' | 'workflow' | 'write' | 'design' | 'collaboration' = 'chat') {
    return {
      activeView,
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onDesignOpen: vi.fn(),
      onCollaborationOpen: vi.fn()
    }
  }

  it('renders four top-level mode tab buttons', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('Code')
    expect(html).toContain('Write')
    expect(html).toContain('Design')
    expect(html).toContain('Collaboration')
    expect(html).not.toContain('Loop')
    expect(html.match(/role="tab"/g)?.length).toBe(4)
  })

  it('uses horizontal row layout not vertical column', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    // Container should have flex-row, not flex-col
    expect(html).toContain('flex-row')
    expect(html).not.toContain('flex-col')
  })

  it('buttons use flex-1 for equal width instead of w-full', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    const flex1Matches = html.match(/flex-1/g)
    expect(flex1Matches?.length).toBe(4)
  })

  it('marks active button with aria-selected true', () => {
    for (const activeView of ['chat', 'write', 'design', 'collaboration'] as const) {
      const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props(activeView)))
      expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
      expect(html.match(/aria-selected="false"/g)?.length).toBe(3)
    }
  })

  it('does not mark a top tab active while the moved Loop view is active', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('workflow')))

    expect(html).not.toContain('aria-selected="true"')
    expect(html.match(/aria-selected="false"/g)?.length).toBe(4)
  })

  it('uses all-or-icon labels instead of truncating tab text', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    expect(html).toContain('workspace-mode-tab-label')
    expect(html).not.toContain('truncate')
  })

  it('preserves min-w-0 on buttons for flex sizing', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    expect(html).toContain('min-w-0')
  })

  it('renders role="tablist" container with descriptive aria-label', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('Code / Write / Design / Collaboration')
  })

  it('does not render secondary switches in the sidebar mode tabs', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, props())
    )

    expect(html).not.toContain('role="switch"')
    expect(html.match(/role="tab"/g)?.length).toBe(4)
  })
})
