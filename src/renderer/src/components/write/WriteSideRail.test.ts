import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWriteEditorBridge } from '../../write/write-editor-bridge'
import { WriteSideRail } from './WriteSideRail'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) =>
    options?.count !== undefined ? `${key}:${options.count}` : key })
}))

function railButton(renderer: ReactTestRenderer, id: string) {
  return renderer.root.find((node) => node.type === 'button' && node.props['data-write-rail-item'] === id)
}

describe('WriteSideRail', () => {
  afterEach(() => {
    useWriteWorkspaceStore.getState().setWriteRightPanelState({ expanded: true, activeId: 'assistant' })
    useWriteEditorBridge.setState({ reviewChunks: [] })
  })

  it('toggles panels and collapses when the visible tool is clicked again', () => {
    useWriteWorkspaceStore.getState().setWriteRightPanelState({ expanded: true, activeId: 'assistant' })
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(createElement(WriteSideRail)) })
    expect(railButton(renderer, 'assistant').props['aria-pressed']).toBe(true)

    act(() => railButton(renderer, 'outline').props.onClick())
    expect(useWriteWorkspaceStore.getState().writeRightPanel).toEqual({ expanded: true, activeId: 'outline' })
    expect(useWriteWorkspaceStore.getState().assistantOpen).toBe(false)

    act(() => railButton(renderer, 'outline').props.onClick())
    expect(useWriteWorkspaceStore.getState().writeRightPanel).toEqual({ expanded: false, activeId: 'outline' })
    expect(railButton(renderer, 'outline').props['aria-pressed']).toBe(false)
  })

  it('labels the review badge with the pending count', () => {
    useWriteEditorBridge.setState({
      reviewChunks: [
        { id: 'a', kind: 'added', before: '', after: 'x' },
        { id: 'b', kind: 'removed', before: 'y', after: '' }
      ]
    })
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(createElement(WriteSideRail)) })
    expect(railButton(renderer, 'review').props['aria-label']).toBe('workRailReviewCount:2')
  })
})
