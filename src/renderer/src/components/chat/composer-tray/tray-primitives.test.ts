import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import {
  TrayAvatar,
  TrayAvatarStack,
  TrayButton,
  TrayFoldRow,
  TrayProgressRing,
  TrayRow,
  TraySegmentButton,
  TraySegmentContent,
  TraySheetHeader,
  TrayStatusPill,
  TrayStopButton
} from './tray-primitives'
import type { TrayKind } from './tray-kind'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0
}

describe('tray segment', () => {
  const kind: TrayKind = {
    id: 'todo',
    align: 'start',
    tone: 'running',
    ariaLabel: 'Tasks, step 3 of 7',
    renderSegment: ({ compact }) => createElement(TraySegmentContent, {
      icon: createElement(TrayProgressRing, { value: 3 / 7 }),
      label: 'Fix review notes',
      count: '3/7',
      compact
    }),
    renderSheet: () => null,
    segmentAttributes: { 'data-todo-plan-outline': 'true' }
  }

  it('wraps the button in the stack-item marker and exposes disclosure state', () => {
    const html = renderToStaticMarkup(createElement(TraySegmentButton, {
      kind, open: true, compact: false, controlsId: 'sheet-1', onClick: vi.fn()
    }))
    expect(html).toMatch(/data-composer-stack-item="todo"><button/)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="sheet-1"')
    expect(html).toContain('data-open="true"')
    expect(html).toContain('data-todo-plan-outline="true"')
    expect(html).toContain('Fix review notes')
    expect(html).toContain('ds-composer-tray-count')
  })

  it('drops the label and uses the aria label as tooltip in compact mode', () => {
    const html = renderToStaticMarkup(createElement(TraySegmentButton, {
      kind, open: false, compact: true, onClick: vi.fn()
    }))
    expect(html).not.toContain('Fix review notes')
    expect(html).toContain('title="Tasks, step 3 of 7"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('aria-controls')
  })

  it('omits aria-expanded for non-expandable segments', () => {
    const html = renderToStaticMarkup(createElement(TraySegmentButton, {
      kind: { ...kind, renderSheet: null, marker: 'dispatch-pill' }, open: false, compact: false, onClick: vi.fn()
    }))
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('data-composer-stack-item="dispatch-pill"')
  })
})

describe('tray sheet and rows', () => {
  it('renders a header with summary, actions and a labelled collapse button', () => {
    const html = renderToStaticMarkup(createElement(TraySheetHeader, {
      title: 'Tasks',
      summary: '4 / 12',
      actions: createElement(TrayButton, { variant: 'ghost' }, 'Open in panel'),
      onCollapse: vi.fn()
    }))
    expect(html).toContain('ds-composer-tray-sheet-title')
    expect(html).toContain('4 / 12')
    expect(html).toContain('Open in panel')
    expect(html).toContain('aria-label="Collapse"')
  })

  it('makes the whole row an open target without nesting buttons', () => {
    const html = renderToStaticMarkup(createElement(TrayRow, {
      title: 'Update login docs',
      subtitle: 'Asks whether to delete the old note',
      onOpen: vi.fn(),
      highlighted: true,
      trailing: createElement(TrayButton, { variant: 'solid' }, 'Answer')
    }))
    expect(html).toContain('data-two-line="true"')
    expect(html).toContain('data-interactive="true"')
    expect(html).toContain('data-highlighted="true"')
    expect(html).toContain('aria-label="Update login docs"')
    // Two sibling buttons (open target + trailing action), never nested.
    expect(countMatches(html, /<button/g)).toBe(2)
    expect(html).not.toMatch(/<button[^>]*>[^]*<button[^>]*>[^]*<\/button>[^]*<\/button>/)
    const openEnd = html.indexOf('</button>')
    expect(html.indexOf('Answer')).toBeGreaterThan(openEnd)
  })

  it('renders a static row when nothing opens it', () => {
    const html = renderToStaticMarkup(createElement(TrayRow, { title: 'npm run lint' , monoTitle: true }))
    expect(html).not.toContain('<button')
    expect(html).not.toContain('data-two-line')
    expect(html).toContain('font-mono')
  })

  it('renders detail under the row on one shared, highlighted surface', () => {
    const html = renderToStaticMarkup(createElement(TrayRow, {
      title: 'npm run dev',
      monoTitle: true,
      highlighted: true,
      onOpen: vi.fn(),
      'data-shell-row': 'sh_1',
      detail: createElement('pre', null, 'ready in 412 ms')
    } as Parameters<typeof TrayRow>[0]))
    expect(html).toMatch(/^<div data-shell-row="sh_1" class="ds-composer-tray-row-group" data-highlighted="true">/)
    // The line itself is not raised separately and the open target covers only the line.
    expect(html).toMatch(/<div class="ds-composer-tray-row" data-interactive="true">/)
    expect(html).toContain('<div class="ds-composer-tray-row-detail"><pre>ready in 412 ms</pre></div>')
    expect(html.indexOf('ds-composer-tray-row-detail')).toBeGreaterThan(html.indexOf('</button>'))
    expect(countMatches(html, /data-highlighted/g)).toBe(1)
  })

  it('folds with a chevron that tracks expansion', () => {
    const open = renderToStaticMarkup(createElement(TrayFoldRow, {
      expanded: true, onToggle: vi.fn(), label: '3 done', controls: 'done-list'
    }))
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('aria-controls="done-list"')
    expect(open).toContain('lucide-chevron-up')
    const closed = renderToStaticMarkup(createElement(TrayFoldRow, {
      expanded: false, onToggle: vi.fn(), label: '7 remaining',
      trailing: createElement(TrayStatusPill, { tone: 'waiting', children: '1 blocked' })
    }))
    expect(closed).toContain('lucide-chevron-down')
    expect(closed).toContain('data-tone="waiting"')
  })
})

describe('tray status and controls', () => {
  it('maps every tone onto the status pill', () => {
    for (const tone of ['default', 'running', 'waiting', 'error', 'done'] as const) {
      expect(renderToStaticMarkup(createElement(TrayStatusPill, { tone, children: tone })))
        .toContain(`data-tone="${tone}"`)
    }
  })

  it('draws the progress arc proportionally and spins when indeterminate', () => {
    const half = renderToStaticMarkup(createElement(TrayProgressRing, { value: 0.5, label: '50%' }))
    const circumference = 2 * Math.PI * 6
    expect(half).toContain(`stroke-dasharray="${(circumference / 2).toFixed(2)} ${circumference.toFixed(2)}"`)
    expect(half).toContain('role="img"')
    const empty = renderToStaticMarkup(createElement(TrayProgressRing, { value: 0 }))
    expect(empty).not.toContain('ds-composer-tray-ring-arc')
    expect(empty).toContain('aria-hidden="true"')
    expect(renderToStaticMarkup(createElement(TrayProgressRing, { indeterminate: true })))
      .toContain('data-indeterminate="true"')
  })

  it('renders the ghost stop button with a filled square', () => {
    const html = renderToStaticMarkup(createElement(TrayStopButton, { onClick: vi.fn() }))
    expect(html).toContain('ds-composer-tray-stop-square')
    expect(html).toContain('Stop')
    const iconOnly = renderToStaticMarkup(createElement(TrayStopButton, { onClick: vi.fn(), iconOnly: true, label: 'Stop worker' }))
    expect(iconOnly).toContain('aria-label="Stop worker"')
  })

  it('renders avatar glyphs and caps stacks', () => {
    const html = renderToStaticMarkup(createElement(TrayAvatarStack, {
      max: 2,
      children: [
        createElement(TrayAvatar, { key: 'a', label: 'Docs writer', color: '#c9741c' }),
        createElement(TrayAvatar, { key: 'b', label: '测试', size: 'lg', title: 'Tester' }),
        createElement(TrayAvatar, { key: 'c', label: 'Review' })
      ]
    }))
    expect(html).toContain('>Do<')
    expect(html).toContain('>测试<')
    expect(html).not.toContain('>Re<')
    expect(html).toContain('data-size="lg"')
    expect(html).toContain('aria-label="Tester"')
  })
})
