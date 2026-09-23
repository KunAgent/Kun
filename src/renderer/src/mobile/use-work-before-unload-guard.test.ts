// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkBeforeUnloadGuard } from './use-work-before-unload-guard'

let root: Root
let host: HTMLDivElement
function Harness({ active, dirty }: { active: boolean; dirty: boolean }) {
  useWorkBeforeUnloadGuard(active, {
    saveStatus: dirty ? 'dirty' : 'saved', conflict: false, reviewActive: false
  })
  return null
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Work beforeunload protection', () => {
  it('prevents unload only when active Work state is unsafe', () => {
    act(() => root.render(createElement(Harness, { active: true, dirty: true })))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    act(() => root.render(createElement(Harness, { active: true, dirty: false })))
    const saved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(saved)
    expect(saved.defaultPrevented).toBe(false)
    act(() => root.render(createElement(Harness, { active: false, dirty: true })))
    const inactive = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(inactive)
    expect(inactive.defaultPrevented).toBe(false)
  })
})
