// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { useWorkPaperSearchMode } from '../../write/work-paper-search-mode'
import { WorkPaperSearchChip } from './WorkPaperSearchChip'

let footer: HTMLDivElement
let textarea: HTMLTextAreaElement
let mount: HTMLDivElement
let root: Root

function keyboardClick(element: HTMLButtonElement): void {
  element.focus()
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useWorkPaperSearchMode.setState({ enabled: false, depth: 'quick', focusRequest: 0 })
  footer = document.createElement('div')
  footer.className = 'write-assistant-footer'
  textarea = document.createElement('textarea')
  mount = document.createElement('div')
  footer.append(mount, textarea)
  document.body.append(footer)
  root = createRoot(mount)
  act(() => root.render(createElement(WorkPaperSearchChip)))
})

afterEach(() => {
  act(() => root.unmount())
  footer.remove()
  vi.unstubAllGlobals()
})

describe('WorkPaperSearchChip', () => {
  it('keeps keyboard focus on the corresponding control when toggled', () => {
    const enable = mount.querySelector<HTMLButtonElement>('button.work-paper-search-chip')!
    act(() => keyboardClick(enable))
    expect(useWorkPaperSearchMode.getState().enabled).toBe(true)
    const remove = mount.querySelector<HTMLButtonElement>('.work-paper-search-remove')!
    expect(document.activeElement).toBe(remove)

    act(() => useWorkPaperSearchMode.getState().setDepth('deep'))
    act(() => keyboardClick(remove))
    expect(useWorkPaperSearchMode.getState().enabled).toBe(false)
    expect(useWorkPaperSearchMode.getState().depth).toBe('quick')
    expect(document.activeElement).toBe(mount.querySelector('button.work-paper-search-chip'))
  })

  it('still moves focus to the composer when started from a home shortcut', () => {
    act(() => useWorkPaperSearchMode.getState().start())
    expect(useWorkPaperSearchMode.getState().enabled).toBe(true)
    expect(document.activeElement).toBe(textarea)
  })
})
