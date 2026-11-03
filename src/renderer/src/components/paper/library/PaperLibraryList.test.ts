/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { PaperLibraryTable } from './PaperLibraryTable'
import { PaperLibraryDetailPanel } from './PaperLibraryDetailPanel'

const t = (key: string, opts?: Record<string, unknown>): string => (opts?.count !== undefined ? `${key}:${opts.count}` : key)

function entry(unitDir: string, patch: Partial<PaperLibraryEntry['meta']> = {}): PaperLibraryEntry {
  return {
    unitDir,
    meta: {
      version: 2,
      title: `Paper ${unitDir}`,
      authors: ['Ada', 'Grace'],
      year: '2025',
      venue: 'ICML',
      importedAt: '2026-09-26T00:00:00Z',
      ...patch
    } as PaperLibraryEntry['meta'],
    hasPdf: true,
    hasNotes: false,
    interpretationCount: 2,
    group: ''
  }
}

let root: Root
let host: HTMLDivElement

describe('paper library list + detail', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders a byline and status pill, and focuses on click / opens on double click', async () => {
    const onOpen = vi.fn()
    const onFocus = vi.fn()
    await act(async () => root.render(createElement(PaperLibraryTable, {
      rows: [entry('a', { status: 'reading' }), entry('b')],
      sort: { key: 'importedAt', dir: 'desc' },
      selection: new Set<string>(),
      activity: {},
      focused: 'a',
      onToggleSort: vi.fn(),
      onToggleSelected: vi.fn(),
      onToggleAll: vi.fn(),
      onOpen,
      onFocus,
      onMenu: vi.fn(),
      t
    })))
    const row = host.querySelector<HTMLElement>('[data-paper-row="a"]')!
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.textContent).toContain('Ada, Grace · ICML 2025')
    expect(row.querySelector('[data-paper-status]')?.getAttribute('data-paper-status')).toBe('reading')
    expect(host.querySelector('[data-paper-row="b"] [data-paper-status]')?.textContent).toBe('writePaperFilterUnread')
    await act(async () => row.click())
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
    await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens on click when no detail panel is available', async () => {
    const onOpen = vi.fn()
    await act(async () => root.render(createElement(PaperLibraryTable, {
      rows: [entry('a')],
      sort: { key: 'importedAt', dir: 'desc' },
      selection: new Set<string>(),
      activity: {},
      onToggleSort: vi.fn(),
      onToggleSelected: vi.fn(),
      onToggleAll: vi.fn(),
      onOpen,
      onMenu: vi.fn(),
      t
    })))
    await act(async () => host.querySelector<HTMLElement>('[data-paper-row="a"]')!.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('detail panel shows the abstract and wires its actions', async () => {
    const onOpen = vi.fn()
    const onInterpret = vi.fn()
    const onOpenSessions = vi.fn()
    await act(async () => root.render(createElement(PaperLibraryDetailPanel, {
      entry: entry('a', { abstract: 'We localize issues.', tags: ['agents'] }),
      sessions: 3,
      onOpen,
      onInterpret,
      onOpenSessions,
      onClose: vi.fn(),
      t
    })))
    const panel = host.querySelector('[data-testid="paper-detail-panel"]')!
    expect(panel.textContent).toContain('We localize issues.')
    expect(panel.textContent).toContain('paperRowSessions:3')
    const button = (label: string): HTMLButtonElement =>
      [...panel.querySelectorAll('button')].find((node) => node.textContent?.includes(label))!
    await act(async () => button('paperDetailOpen').click())
    await act(async () => button('paperDetailInterpret').click())
    await act(async () => button('paperRowSessions').click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onInterpret).toHaveBeenCalledTimes(1)
    expect(onOpenSessions).toHaveBeenCalledTimes(1)
  })
})
