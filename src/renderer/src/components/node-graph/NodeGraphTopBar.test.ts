// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string): string => key })
}))

const { NodeGraphTopBar } = await import('./NodeGraphTopBar')

let root: Root | null = null
let container: HTMLElement | null = null

const BASE = {
  search: '',
  onSearchChange: () => undefined,
  scopeLabel: 'All',
  onCycleScope: () => undefined,
  scopeTitle: 'Scope',
  loading: false,
  stats: '3 nodes',
  onRefresh: () => undefined,
  onFit: () => undefined,
  onExport: () => undefined,
  controlsOpen: true,
  onToggleControls: () => undefined,
  panelOpen: true,
  onTogglePanel: () => undefined
}

const INSET = 'ds-window-controls-collapsed-titlebar-inset'

function render(props: Record<string, unknown>): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(createElement(NodeGraphTopBar, { ...BASE, ...props } as never)))
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

describe('NodeGraphTopBar window-control clearance', () => {
  it('insets the leading group while the app sidebar is collapsed', () => {
    // Collapsed, the row starts at the window edge, which on macOS is where the
    // traffic lights are.
    const host = render({ onToggleAppSidebar: () => undefined, appSidebarCollapsed: true })
    expect(host.querySelector(`.${INSET}`)).not.toBeNull()
  })

  it('drops the inset once the sidebar is showing again', () => {
    const host = render({ onToggleAppSidebar: () => undefined, appSidebarCollapsed: false })
    expect(host.querySelector(`.${INSET}`)).toBeNull()
  })

  it('never insets when embedded, where there is no window edge to clear', () => {
    // The Work tab renders the graph without the sidebar toggle; its own chrome
    // is above, so the traffic lights are somebody else's problem.
    const host = render({})
    expect(host.querySelector(`.${INSET}`)).toBeNull()
    expect(host.querySelector('button[aria-label="sidebarExpand"]')).toBeNull()
  })

  it('uses the shared titlebar toggle, so it matches the sibling views', () => {
    const host = render({ onToggleAppSidebar: () => undefined, appSidebarCollapsed: true })
    const toggle = host.querySelector('button[aria-label="sidebarExpand"]')
    expect(toggle).not.toBeNull()
    expect(toggle!.className).toContain('ds-titlebar-sidebar-toggle')
    // The header is a drag region; the button has to opt out or it cannot be clicked.
    expect(toggle!.className).toContain('ds-no-drag')
  })
})
