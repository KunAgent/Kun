import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createWriteDocumentSession } from '../../write/write-editor-layout'
import { WriteEditorTabBar } from './WriteEditorTabBar'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('../sidebar/SidebarPrimitives', () => ({ SidebarTitlebarToggleButton: () => null }))

const noop = (): void => undefined

describe('WriteEditorTabBar', () => {
  it('activates and closes tabs through accessible tab controls', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const onToggleAssistant = vi.fn()
    const document = createWriteDocumentSession({
      path: '/work/draft.md',
      kind: 'text',
      fileContent: 'draft',
      persistedContent: 'saved',
      saveStatus: 'dirty'
    })
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(WriteEditorTabBar, {
        group: {
          id: 'primary',
          tabs: [{ path: '/work/draft.md', viewMode: 'rich' }],
          activePath: '/work/draft.md'
        },
        documentsByPath: { '/work/draft.md': document },
        focused: true,
        primary: true,
        leftSidebarCollapsed: false,
        onToggleLeftSidebar: noop,
        onActivate,
        onClose,
        onMove: noop,
        onCreateDraft: noop,
        onQuickOpen: noop,
        onSplit: noop,
        onCloseGroup: noop,
        hasSecondGroup: false,
        assistantOpen: true,
        showAssistantToggle: true,
        onToggleAssistant
      }))
    })
    const tab = renderer.root.findByProps({ role: 'tab' })
    expect(tab.props['aria-selected']).toBe(true)
    act(() => tab.props.onClick())
    expect(onActivate).toHaveBeenCalledWith('/work/draft.md')
    const keyboardEventTarget = {}
    act(() => tab.props.onKeyDown({
      key: 'Enter',
      target: keyboardEventTarget,
      currentTarget: keyboardEventTarget,
      preventDefault: noop
    }))
    expect(onActivate).toHaveBeenCalledTimes(2)
    const close = renderer.root.findByProps({ 'aria-label': 'writeCloseTab' })
    act(() => close.props.onClick({ stopPropagation: noop }))
    expect(onClose).toHaveBeenCalledWith('/work/draft.md')
    const assistantToggle = renderer.root.findByProps({ 'aria-label': 'writeToggleAssistant' })
    expect(assistantToggle.props['aria-pressed']).toBe(true)
    expect(assistantToggle.props['data-active']).toBe(true)
    act(() => assistantToggle.props.onClick())
    expect(onToggleAssistant).toHaveBeenCalledOnce()
  })

  it('creates and labels a first-class whiteboard tab', () => {
    const onCreateWhiteboard = vi.fn()
    const onActivate = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(WriteEditorTabBar, {
        group: {
          id: 'primary',
          tabs: [{ kind: 'whiteboard', boardId: 'board-1', viewMode: 'rich' }],
          activePath: 'whiteboard:board-1'
        },
        documentsByPath: {},
        whiteboards: {
          'board-1': {
            id: 'board-1', title: 'Pitch map', workspaceRoot: '/work', threadId: 'thread-1',
            phase: 'blank', revision: 0, createdAt: '2026-08-13', updatedAt: '2026-08-13'
          }
        },
        focused: true,
        primary: true,
        leftSidebarCollapsed: false,
        onToggleLeftSidebar: noop,
        onActivate,
        onClose: noop,
        onMove: noop,
        onCreateDraft: noop,
        onCreateWhiteboard,
        onQuickOpen: noop,
        onSplit: noop,
        onCloseGroup: noop,
        hasSecondGroup: false,
        assistantOpen: false,
        showAssistantToggle: true,
        onToggleAssistant: noop
      }))
    })
    const tab = renderer.root.findByProps({ role: 'tab' })
    expect(tab.findAllByType('span').some((span) => span.children.includes('Pitch map'))).toBe(true)
    act(() => tab.props.onClick())
    expect(onActivate).toHaveBeenCalledWith('whiteboard:board-1')

    const add = renderer.root.findByProps({ 'aria-label': 'writeAddTab' })
    act(() => add.props.onClick())
    const createBoard = renderer.root.findAllByType('button').find((button) =>
      button.children.some((child) => child === 'writeCreateWhiteboard')
    )
    expect(createBoard).toBeDefined()
    act(() => createBoard!.props.onClick())
    expect(onCreateWhiteboard).toHaveBeenCalledOnce()
  })
})
