import { createElement, type PointerEvent as ReactPointerEvent } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { useRoomWorkbenchLayout } from './useRoomWorkbenchLayout'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { WORKBENCH_RESIZE_CLASS } from '../workbench-layout-storage'

let layout: ReturnType<typeof useRoomWorkbenchLayout>
let renderer: ReactTestRenderer
const classes = new Set<string>()
const body = { style: { cursor: 'default', userSelect: 'text' }, classList: {
  add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value)
} }
const workspace = { clientWidth: 1400, querySelector: () => null }
const pointerTarget = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true }
function Harness({ visible = true, scope = 'room-a' }: { visible?: boolean; scope?: string }) {
  layout = useRoomWorkbenchLayout(visible, scope)
  return createElement('div', { ref: layout.panelRef })
}
const startResize = () => layout.beginResize({ button: 0, clientX: 800, pointerId: 1,
  currentTarget: pointerTarget, preventDefault: vi.fn() } as unknown as ReactPointerEvent<HTMLDivElement>)
const move = () => { window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 700 })) }
beforeEach(() => {
  classes.clear(); vi.clearAllMocks(); workspace.clientWidth = 1400
  body.style = { cursor: 'default', userSelect: 'text' }
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1800 }))
  vi.stubGlobal('document', { body })
  useRoomPresentationPreferences.getState().setPreference({ workbenchWidth: 560 })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
const mount = async () => {
  await act(async () => { renderer = create(createElement(Harness), {
    createNodeMock: () => ({ closest: () => workspace })
  }) })
}

describe('room workbench resize lifecycle', () => {
  it('measures the local stage and refits after a window resize without persisting a narrow constraint', async () => {
    await mount()
    expect(layout.width).toBe(560)
    workspace.clientWidth = 900
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(layout.width).toBe(283)
    expect(useRoomPresentationPreferences.getState().workbenchWidth).toBe(560)
  })
  it.each(['collapse', 'room switch', 'unmount'])('releases pointer capture and listeners on %s', async (end) => {
    await mount()
    act(startResize)
    expect(pointerTarget.setPointerCapture).toHaveBeenCalledWith(1)
    expect(classes.has(WORKBENCH_RESIZE_CLASS)).toBe(true)
    act(move)
    expect(layout.width).toBe(660)
    act(() => {
      if (end === 'unmount') renderer.unmount()
      else renderer.update(createElement(Harness, end === 'collapse' ? { visible: false } : { scope: 'room-b' }))
    })
    expect(pointerTarget.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(classes.has(WORKBENCH_RESIZE_CLASS)).toBe(false)
    expect(body.style).toEqual({ cursor: 'default', userSelect: 'text' })
    act(move)
    expect(useRoomPresentationPreferences.getState().workbenchWidth).toBe(660)
  })
  it('has no Rooms overlay override that can cover the conversation', () => {
    for (const filename of ['rooms-workbench.css', 'rooms-polish.css']) {
      const css = readFileSync(new URL(filename, import.meta.url), 'utf8')
      expect(css).not.toMatch(/\.rooms-workbench-right-panel\s*\{[^}]*position:\s*absolute/)
    }
  })
})
