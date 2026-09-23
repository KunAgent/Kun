// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileWorkHome, type MobileWorkHomeProps } from './MobileWorkHome'

let root: Root
let host: HTMLDivElement
function props(): MobileWorkHomeProps {
  return {
    workspaceLabel: 'Project', search: '', loading: false, error: '',
    resources: [
      { key: 'document', title: 'Report.md', detail: 'docs', kind: 'document', status: 'dirty' },
      { key: 'board', title: 'Planning', detail: 'Whiteboard', kind: 'whiteboard', status: 'review' }
    ],
    labels: { title: 'Work', search: 'Search', create: 'Create', more: 'More', empty: 'Empty', loading: 'Loading', retry: 'Retry' },
    onWorkspace: vi.fn(), onSearch: vi.fn(), onOpen: vi.fn(), onMenu: vi.fn(), onCreate: vi.fn(), onRetry: vi.fn()
  }
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('mobile Work home', () => {
  it('shows resource kind and data-safety state with explicit actions', () => {
    const input = props()
    act(() => root.render(createElement(MobileWorkHome, input)))
    expect(host.textContent).toContain('dirty')
    expect(host.textContent).toContain('review')
    const open = host.querySelectorAll('.kun-mobile-work-open')
    act(() => (open[1] as HTMLButtonElement).click())
    expect(input.onOpen).toHaveBeenCalledWith(input.resources[1])
    act(() => (host.querySelector('[aria-label="More: Report.md"]') as HTMLButtonElement).click())
    expect(input.onMenu).toHaveBeenCalledWith(input.resources[0])
  })

  it('does not claim an empty workspace when refresh failed', () => {
    const input = { ...props(), resources: [], error: 'Cannot load' }
    act(() => root.render(createElement(MobileWorkHome, input)))
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
})
