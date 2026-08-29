// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FOCUS_MODE_ATTRIBUTE } from '../../node-graph/kun-node-style'
import { DEFAULT_NODE_GRAPH_SETTINGS } from '../../node-graph/node-graph-settings'
import type { NodeGraphNode } from '../../node-graph/node-graph-types'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string): string => key })
}))

const { NodeGraphKindGlyph } = await import('./NodeGraphKindLegend')
const { NodeGraphControls } = await import('./NodeGraphControls')
const { NodeGraphContextMenu } = await import('./NodeGraphContextMenu')

let root: Root | null = null
let container: HTMLElement | null = null

function render(element: ReturnType<typeof createElement>): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(element))
  return container
}

function setFocusMode(state: 'on' | 'off'): void {
  document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, state)
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  document.documentElement.removeAttribute(FOCUS_MODE_ATTRIBUTE)
})

describe('NodeGraphKindGlyph', () => {
  it('shows the Kun artwork with focus mode off', () => {
    setFocusMode('off')
    const host = render(createElement(NodeGraphKindGlyph, { kind: 'workspace' }))
    const image = host.querySelector('img')
    expect(image).not.toBeNull()
    expect(image!.getAttribute('src')).toMatch(/^data:image\/svg\+xml[,;]/)
    expect(host.querySelector('svg')).toBeNull()
  })

  it('shows the coloured silhouette with focus mode on', () => {
    setFocusMode('on')
    const host = render(createElement(NodeGraphKindGlyph, { kind: 'workspace' }))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('svg path')?.getAttribute('fill')).toBe('#a855f7')
  })

  it('keeps the silhouette for a kind with no artwork, either way', () => {
    for (const state of ['off', 'on'] as const) {
      setFocusMode(state)
      const host = render(createElement(NodeGraphKindGlyph, { kind: 'memory' }))
      expect(host.querySelector('img'), state).toBeNull()
      expect(host.querySelector('svg'), state).not.toBeNull()
      act(() => root!.unmount())
      root = null
      container?.remove()
    }
  })
})

const CONTROL_PROPS = {
  settings: DEFAULT_NODE_GRAPH_SETTINGS,
  counts: {},
  focusedLabel: null,
  onPatch: () => undefined,
  onToggleKind: () => undefined,
  onAddGroup: () => undefined,
  onUpdateGroup: () => undefined,
  onRemoveGroup: () => undefined,
  onReset: () => undefined,
  onExitLocalGraph: () => undefined
}

describe('NodeGraphControls colour controls', () => {
  it('withholds the group editor with focus mode off, and says why', () => {
    setFocusMode('off')
    const host = render(createElement(NodeGraphControls, CONTROL_PROPS))
    expect(host.textContent).toContain('nodeGraphKunStyleNote')
    expect(host.textContent).not.toContain('nodeGraphGroups')
    expect(host.querySelector('input[type="color"]')).toBeNull()
  })

  it('restores the group editor with focus mode on', () => {
    setFocusMode('on')
    const host = render(createElement(NodeGraphControls, CONTROL_PROPS))
    expect(host.textContent).toContain('nodeGraphGroups')
    expect(host.textContent).not.toContain('nodeGraphKunStyleNote')
  })
})

const NODE: NodeGraphNode = { id: 'a', kind: 'thread', label: 'Thread', degree: 1 }

const MENU_PROPS = {
  state: { node: NODE, x: 40, y: 40 },
  groups: DEFAULT_NODE_GRAPH_SETTINGS.groups,
  connectedCount: 3,
  onClose: () => undefined,
  onColorNode: () => undefined,
  onAssignGroup: () => undefined,
  onCreateGroup: () => undefined,
  onClearGroup: () => undefined,
  onFocusNode: () => undefined,
  onPathStart: () => undefined,
  onPathEnd: () => undefined,
  pathStartActive: false
}

describe('NodeGraphContextMenu colour controls', () => {
  it('drops the swatches and group rows with focus mode off', () => {
    setFocusMode('off')
    const host = render(createElement(NodeGraphContextMenu, MENU_PROPS))
    expect(host.textContent).not.toContain('nodeGraphMenuColor')
    expect(host.textContent).not.toContain('nodeGraphMenuNewGroup')
    expect(host.textContent).not.toContain('nodeGraphMenuIncludeConnected')
    // The navigation half of the menu is untouched — it has nothing to do with colour.
    expect(host.textContent).toContain('nodeGraphFocusLocal')
    expect(host.textContent).toContain('nodeGraphMenuPathStart')
  })

  it('offers them again with focus mode on', () => {
    setFocusMode('on')
    const host = render(createElement(NodeGraphContextMenu, MENU_PROPS))
    expect(host.textContent).toContain('nodeGraphMenuColor')
    expect(host.textContent).toContain('nodeGraphMenuNewGroup')
    expect(host.textContent).toContain('nodeGraphFocusLocal')
  })
})
