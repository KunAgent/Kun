import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { readStylesheetBundle } from '../../../testing/stylesheet-bundle'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

const attention = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../rooms/useRoomEvents', () => ({
  useRoomAttentionCount: () => attention.count
}))

describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    attention.count = 0
    await i18n.changeLanguage('en')
  })

  function props(activeView: 'chat' | 'workflow' | 'write' | 'design' | 'rooms' = 'chat') {
    return {
      activeView,
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onRoomsOpen: vi.fn()
    }
  }

  function renderInteractive(activeView: 'chat' | 'workflow' | 'write' | 'design' | 'rooms' = 'chat') {
    const componentProps = props(activeView)
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(WorkspaceModeTabs, componentProps))
    })
    return { componentProps, renderer }
  }

  it('renders one compact Code/Work menu trigger instead of segmented tabs', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('data-workspace-mode-trigger="true"')
    expect(html).toContain('data-workspace-mode="chat"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('border-transparent')
    expect(html).toContain('bg-transparent')
    expect(html).toContain('hover:bg-[var(--ds-sidebar-field-bg)]')
    expect(html).not.toContain('border-[var(--ds-sidebar-row-ring)]')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('data-workspace-mode="design"')
  })

  it('opens an overlaid menu with Code and Work descriptions', () => {
    const { renderer } = renderInteractive()
    const trigger = renderer.root.findByProps({ 'data-workspace-mode-trigger': true })

    act(() => trigger.props.onClick())

    const options = renderer.root.findAllByProps({ role: 'menuitemradio' })
    expect(options).toHaveLength(3)
    expect(options.map((option) => option.props['data-workspace-mode'])).toEqual(['write', 'chat', 'rooms'])
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1)
    const rendered = JSON.stringify(renderer.toJSON())
    expect(rendered).toContain('Build, debug, and ship')
    expect(rendered).toContain('Write, organize, and handle everyday tasks')
    act(() => renderer.unmount())
  })

  it('keeps each sidebar mode control above the sections rendered after it', async () => {
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

  it('marks the current mode and invokes only the newly selected mode callback', () => {
    const { componentProps, renderer } = renderInteractive()
    const trigger = renderer.root.findByProps({ 'data-workspace-mode-trigger': true })
    act(() => trigger.props.onClick())

    const options = renderer.root.findAllByProps({ role: 'menuitemradio' })
    expect(options[0]?.props['aria-checked']).toBe(false)
    expect(options[1]?.props['aria-checked']).toBe(true)

    act(() => options[0]?.props.onClick())

    expect(componentProps.onWriteOpen).toHaveBeenCalledOnce()
    expect(componentProps.onCodeOpen).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('opens with arrow keys for keyboard navigation', () => {
    const { renderer } = renderInteractive()
    const trigger = renderer.root.findByProps({ 'data-workspace-mode-trigger': true })
    const preventDefault = vi.fn()

    act(() => trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault }))

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ role: 'menuitemradio' })).toHaveLength(3)
    act(() => renderer.unmount())
  })

  it('hides the rooms attention count after Rooms is opened', () => {
    attention.count = 3
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('rooms')))
    expect(html).toContain('title="Rooms"')
    expect(html).not.toContain(' · 3')
    expect(html).not.toContain('>3<')
  })

  it('shows a rooms attention badge while another workspace is active', () => {
    attention.count = 3
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('chat')))
    expect(html).toContain(`aria-label="${i18n.t('roomsAttention')}"`)
    expect(html).toContain('>3<')
    expect(html).not.toContain('Rooms · 3')
  })

  it('does not keep the rooms count in the open menu once Rooms is selected', () => {
    attention.count = 3
    const { renderer } = renderInteractive('rooms')
    act(() => renderer.root.findByProps({ 'data-workspace-mode-trigger': true }).props.onClick())
    expect(JSON.stringify(renderer.toJSON())).not.toContain('>3<')
    expect(JSON.stringify(renderer.toJSON())).not.toContain(' · 3')
    act(() => renderer.unmount())
  })

  it('opens Rooms through the dedicated callback and labels its active mode', () => {
    const { componentProps, renderer } = renderInteractive()
    act(() => renderer.root.findByProps({ 'data-workspace-mode-trigger': true }).props.onClick())
    act(() => renderer.root.findAllByProps({ role: 'menuitemradio' })[2]?.props.onClick())
    expect(componentProps.onRoomsOpen).toHaveBeenCalledOnce()
    expect(componentProps.onCodeOpen).not.toHaveBeenCalled()
    act(() => renderer.unmount())
    expect(renderToStaticMarkup(createElement(WorkspaceModeTabs, props('rooms')))).toContain('title="Rooms"')
  })

  it('uses Work as the trigger value in the Work workspace', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('write')))

    expect(html).toContain('data-workspace-mode="write"')
    expect(html).toContain('title="Work"')
  })

  it('projects legacy Design and subordinate Code views through Code', () => {
    for (const activeView of ['design', 'workflow'] as const) {
      const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props(activeView)))
      expect(html).toContain('data-workspace-mode="chat"')
      expect(html).not.toContain('data-workspace-mode="design"')
    }
  })

  it('keeps the trigger label visible in narrow sidebars', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('workspace-mode-tab-label')
    expect(html).toContain('min-w-0')
    expect(html).not.toContain('flex-1')
  })

  it('exposes a descriptive label and locks mode navigation when requested', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, {
      ...props('design'),
      disabled: true,
      disabledReason: 'Preparing the drawing'
    }))

    expect(html).toContain(`aria-label="${i18n.t('code')} / ${i18n.t('workspaceModeWorkLabel')} / ${i18n.t('roomsLabel')}"`)
    expect(html).toContain('disabled=""')
    expect(html).toContain('title="Preparing the drawing"')
    expect(html).not.toContain('role="menu"')
  })
})
