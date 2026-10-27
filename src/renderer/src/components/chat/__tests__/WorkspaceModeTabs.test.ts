import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { readStylesheetBundle } from '../../../testing/stylesheet-bundle'
import { useSidebarScopeStore } from '../sidebar-scope-store'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

const attention = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../rooms/useRoomEvents', () => ({
  useRoomAttentionCount: () => attention.count
}))

type View = 'chat' | 'workflow' | 'write' | 'design' | 'rooms' | 'ade'

describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    attention.count = 0
    useSidebarScopeStore.setState({ scope: 'code' })
    await i18n.changeLanguage('en')
  })

  function props(activeView: View = 'chat') {
    return {
      activeView,
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onAdeOpen: vi.fn()
    }
  }

  function renderInteractive(activeView: View = 'chat') {
    const componentProps = props(activeView)
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(WorkspaceModeTabs, componentProps))
    })
    return { componentProps, renderer }
  }

  const tab = (renderer: ReactTestRenderer, mode: string) =>
    renderer.root.findByProps({ role: 'tab', 'data-workspace-mode': mode })

  it('renders Code, Work and Chats as one pill switch with the selected label only', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('role="tablist"')
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3)
    expect(html).toContain('aria-label="Code / Work / Chats"')
    expect(html).toContain('kun-mode-thumb')
    expect(html).toContain('kun-mode-tab-label')
    expect((html.match(/kun-mode-tab-label/g) ?? []).length).toBe(1)
    expect(html).not.toContain('aria-haspopup="menu"')
    expect(html).not.toContain('data-workspace-mode="design"')
  })

  it('marks the current mode and invokes only the newly selected mode callback', () => {
    const { componentProps, renderer } = renderInteractive()
    expect(tab(renderer, 'chat').props['aria-selected']).toBe(true)
    expect(tab(renderer, 'write').props['aria-selected']).toBe(false)

    act(() => tab(renderer, 'write').props.onClick())

    expect(componentProps.onWriteOpen).toHaveBeenCalledOnce()
    expect(componentProps.onCodeOpen).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('does not navigate when the current mode is picked again', () => {
    const { componentProps, renderer } = renderInteractive('write')
    act(() => tab(renderer, 'write').props.onClick())
    expect(componentProps.onWriteOpen).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('opens Chats by flipping the sidebar scope without leaving Code', () => {
    const { componentProps, renderer } = renderInteractive('chat')

    act(() => tab(renderer, 'chats').props.onClick())

    expect(useSidebarScopeStore.getState().scope).toBe('chats')
    expect(componentProps.onCodeOpen).not.toHaveBeenCalled()
    expect(componentProps.onWriteOpen).not.toHaveBeenCalled()
    expect(tab(renderer, 'chats').props['aria-selected']).toBe(true)
    act(() => tab(renderer, 'chat').props.onClick())
    expect(useSidebarScopeStore.getState().scope).toBe('code')
    act(() => renderer.unmount())
  })

  it('returns to Code from another view when Chats or Code is picked', () => {
    const { componentProps, renderer } = renderInteractive('write')
    act(() => tab(renderer, 'chats').props.onClick())
    expect(componentProps.onCodeOpen).toHaveBeenCalledOnce()
    expect(useSidebarScopeStore.getState().scope).toBe('chats')
    act(() => renderer.unmount())
  })

  it('moves between tabs with the arrow keys', () => {
    const { renderer } = renderInteractive()
    const focus = vi.fn()
    // Refs are not attached in the test renderer; the handler must not throw without them.
    const preventDefault = vi.fn()
    act(() => tab(renderer, 'chat').props.onKeyDown({ key: 'ArrowRight', preventDefault }))
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('puts an unread dot on Chats only while another tab is selected', () => {
    attention.count = 3
    const inCode = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('chat')))
    expect(inCode).toContain('kun-mode-tab-dot')
    expect(inCode).toContain(`${i18n.t('workspaceModeChatsLabel')} · ${i18n.t('roomsAttention')}`)
    expect(inCode).not.toContain('>3<')

    const { renderer } = renderInteractive('chat')
    expect(JSON.stringify(renderer.toJSON())).toContain('kun-mode-tab-dot')
    act(() => tab(renderer, 'chats').props.onClick())
    expect(JSON.stringify(renderer.toJSON())).not.toContain('kun-mode-tab-dot')
    act(() => renderer.unmount())
  })

  it('keeps the mode control above the sections rendered after it', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const sidebarSources = await Promise.all([
      new URL('../Sidebar.tsx', import.meta.url),
      new URL('../../write/WriteSidebar.tsx', import.meta.url),
      new URL('../../design/DesignSidebar.tsx', import.meta.url)
    ].map((url) => readFile(url, 'utf8')))
    const surfaces = await readStylesheetBundle(
      new URL('../../../styles/surfaces-write.css', import.meta.url)
    )

    for (const source of sidebarSources) {
      expect(source).toContain('className="workspace-mode-controls ')
    }
    expect(surfaces).toMatch(
      /\.ds-sidebar-shell > \.workspace-mode-controls\s*\{[^}]*z-index:\s*2;/s
    )
  })

  it('projects legacy ADE, Rooms, Design and workflow views onto the Code tab', () => {
    for (const activeView of ['ade', 'rooms', 'design', 'workflow'] as const) {
      const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props(activeView)))
      expect(html).toContain('data-workspace-mode="chat"')
      expect(html).toContain('title="Code"')
      expect(html).not.toContain('data-workspace-mode="ade"')
      expect(html).not.toContain('data-workspace-mode="rooms"')
      expect(html).not.toContain('data-workspace-mode="design"')
    }
  })

  it('shows Work as the selected tab in the Work workspace', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('write')))

    expect(html).toContain('data-workspace-mode="write"')
    expect(html).toContain('title="Work"')
  })

  it('exposes a descriptive label and locks mode navigation when requested', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, {
      ...props('design'),
      disabled: true,
      disabledReason: 'Preparing the drawing'
    }))

    expect(html).toContain(
      `aria-label="${i18n.t('code')} / ${i18n.t('workspaceModeWorkLabel')} / ${i18n.t('workspaceModeChatsLabel')}"`
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('title="Preparing the drawing"')
    expect(html).not.toContain('role="menu"')
  })
})
