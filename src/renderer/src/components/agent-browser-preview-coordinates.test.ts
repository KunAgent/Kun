import { createElement, Fragment, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserSurfaceHost } from './AgentBrowserSurfaceHost'
import { AgentBrowserSurfaceSlot } from './AgentBrowserSurfaceSlot'
import { AgentBrowserPanel } from './AgentBrowserPanel'
import { useAgentBrowserSurfaceStore } from './agent-browser-surface-store'
import { useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import { useAgentBrowserPreviewFrame } from './use-agent-browser-preview-frame'
import { useAgentBrowserOccluded } from './use-agent-browser-occluded'
import { AgentBrowserPreviewShell } from './AgentBrowserPreviewShell'
import i18n from '../i18n'

vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('./AgentBrowserPanel', () => ({ AgentBrowserPanel: () => null }))

const state: BrowserUseViewState = {
  contractVersion: 1, capabilityStatus: 'available', sessionId: 'session-1234567890', threadId: 'thread', turnId: 'turn',
  lifecycle: 'ready', controlOwner: 'agent', visible: false, mounted: false, mode: 'public', tabs: [], updatedAt: '2026-11-04T00:00:00Z'
}
let scale = 1
let renderer: ReactTestRenderer | undefined
const observers = new Set<() => void>()
let overlays: unknown[] = []

beforeEach(() => {
  scale = 1
  overlays = []
  observers.clear()
  useAgentBrowserSurfaceStore.setState({ byThreadId: {} })
  useAgentBrowserPreviewStore.setState({ byThreadId: {} })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('document', { body: {}, documentElement: {}, querySelectorAll: () => overlays })
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ zoom: String(scale), display: 'block', visibility: 'visible' }),
    addEventListener: vi.fn(), removeEventListener: vi.fn()
  })
  class Observer {
    constructor(private callback: () => void) { observers.add(callback) }
    observe() {}
    disconnect() { observers.delete(this.callback) }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('MutationObserver', Observer)
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

function ObservedHost() {
  const occluded = useAgentBrowserOccluded()
  return createElement(AgentBrowserSurfaceHost, { state, activeThreadId: 'thread', occluded })
}

async function renderSurface() {
  await act(async () => {
    renderer = create(createElement(Fragment, null,
      createElement(AgentBrowserSurfaceSlot, { state, variant: 'pip' }),
      createElement(ObservedHost)
    ), { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 120 * scale, y: 80 * scale, width: 640 * scale, height: 400 * scale }) }) })
  })
}

it.each([0.8, 1, 1.25, 1.5])('converts visual slot bounds back to layout units exactly once at UI scale %s', async (zoom) => {
  scale = zoom
  await renderSurface()
  const host = renderer!.root.findByProps({ 'data-agent-browser-surface-host': true })
  expect(host.props.className).toContain('z-[81]')
  expect(host.props.style).toMatchObject({ left: 120, top: 80, width: 640, height: 400 })
  expect(useAgentBrowserSurfaceStore.getState().byThreadId.thread.rect).toEqual({ x: 120 * zoom, y: 80 * zoom, width: 640 * zoom, height: 400 * zoom })
})

it('remeasures on body scale changes without disposing the surface owner', async () => {
  await renderSurface()
  const owner = useAgentBrowserSurfaceStore.getState().byThreadId.thread.owner
  scale = 1.5
  await act(async () => { for (const update of [...observers]) update() })
  expect(useAgentBrowserSurfaceStore.getState().byThreadId.thread.owner).toBe(owner)
  expect(renderer!.root.findByProps({ 'data-agent-browser-surface-host': true }).props.style).toMatchObject({ left: 120, top: 80, width: 640, height: 400 })
})

it('hides the native presentation for an app modal and restores the same panel after dismissal', async () => {
  await renderSurface()
  const panel = renderer!.root.findByType(AgentBrowserPanel)
  expect(panel.props.displayVisible).toBe(true)
  overlays = [{ closest: () => null, getClientRects: () => [{}] }]
  await act(async () => { for (const update of [...observers]) update() })
  expect(renderer!.root.findByType(AgentBrowserPanel)).toBe(panel)
  expect(panel.props.displayVisible).toBe(false)
  overlays = []
  await act(async () => { for (const update of [...observers]) update() })
  expect(panel.props.displayVisible).toBe(true)
})

it('hides the expanded shell along with its viewport when an app modal occludes it', async () => {
  await i18n.changeLanguage('en')
  const children = vi.fn(() => null)
  const props = { state, children, onClose: vi.fn(), onToggleControl: vi.fn(), onNavigate: vi.fn(), onZoom: vi.fn(), onStop: vi.fn(), onClear: vi.fn() }
  await act(async () => {
    renderer = create(createElement(AgentBrowserPreviewShell, props), {
      createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 1200, height: 900 }) })
    })
  })
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Expand browser' }).props.onClick())
  expect(renderer!.root.findByProps({ 'data-browser-preview-frame': true }).props['data-browser-preview-expanded']).toBe(true)
  await act(async () => renderer!.update(createElement(AgentBrowserPreviewShell, { ...props, occluded: true })))
  expect(renderer!.root.findByProps({ 'data-browser-preview-frame': true }).props.style.visibility).toBe('hidden')
  expect(children).toHaveBeenLastCalledWith(expect.anything(), false)
  await act(async () => renderer!.update(createElement(AgentBrowserPreviewShell, props)))
  expect(renderer!.root.findByProps({ 'data-browser-preview-frame': true }).props.style.visibility).toBe('visible')
  expect(children).toHaveBeenLastCalledWith(expect.anything(), true)
})

let gestures: ReturnType<typeof useAgentBrowserPreviewFrame>
function Frame() {
  const ref = useRef<HTMLDivElement | null>(null)
  gestures = useAgentBrowserPreviewFrame(ref, state, true)
  return createElement('div', { ref })
}
function pointer(x: number, y: number) {
  return {
    button: 0, pointerId: 1, clientX: x, clientY: y,
    currentTarget: { setPointerCapture: vi.fn() }, preventDefault: vi.fn(), stopPropagation: vi.fn()
  } as unknown as Parameters<typeof gestures.begin>[0]
}
async function renderFrame() {
  useAgentBrowserPreviewStore.getState().observe(state, 'thread')
  useAgentBrowserPreviewStore.getState().setGeometry(state, { width: 642, position: { x: 100, y: 100 } })
  await act(async () => { renderer = create(createElement(Frame), { createNodeMock: () => ({
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1200 * scale, height: 900 * scale })
  }) }) })
}

it.each([0.8, 1, 1.25, 1.5])('uses layout coordinates for drag and proportional resize at UI scale %s', async (zoom) => {
  scale = zoom
  await renderFrame()
  expect(gestures.frame).toMatchObject({ x: 100, y: 100, width: 642, height: 522 })
  await act(async () => gestures.begin(pointer(0, 0)))
  await act(async () => gestures.pointerEvents.onPointerMove(pointer(80 * zoom, 40 * zoom)))
  expect(gestures.frame).toMatchObject({ x: 180, y: 140, width: 642 })
  await act(async () => gestures.begin(pointer(0, 0), 'se'))
  await act(async () => gestures.pointerEvents.onPointerMove(pointer(160 * zoom, 100 * zoom)))
  expect(gestures.frame).toMatchObject({ x: 180, y: 140, width: 802, height: 622 })
})

it('cancels an in-flight gesture when the UI scale changes', async () => {
  await renderFrame()
  await act(async () => gestures.begin(pointer(0, 0)))
  scale = 1.25
  await act(async () => { for (const update of [...observers]) update() })
  await act(async () => gestures.pointerEvents.onPointerMove(pointer(200, 100)))
  expect(gestures.frame).toMatchObject({ x: 100, y: 100, width: 642 })
})
