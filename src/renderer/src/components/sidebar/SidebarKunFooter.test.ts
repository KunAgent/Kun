/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import { SidebarFocusModeSwitch, SidebarKunStatus, useSidebarSceneFooter } from './SidebarKunFooter'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = value
}

describe('Sidebar Kun footer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setReactActEnvironment(true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
  })

  it('shows the runtime state beside the Kun face and opens Kun settings', async () => {
    const onOpen = vi.fn()
    useChatStore.setState({ runtimeConnection: 'ready' })
    await act(async () => root.render(createElement(SidebarKunStatus, { onOpen })))
    const button = container.querySelector<HTMLButtonElement>('.ds-sidebar-kun-status')!
    expect(button.dataset.runtimeConnection).toBe('ready')
    expect(button.textContent).toContain('sidebarKunStatusReady')
    expect(button.querySelector('.rooms-avatar-art')).not.toBeNull()
    await act(async () => useChatStore.setState({ runtimeConnection: 'offline' }))
    expect(button.textContent).toContain('sidebarKunStatusOffline')
    await act(async () => button.click())
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('keeps Focus mode a switch with an icon-only control', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(createElement(SidebarFocusModeSwitch, { enabled: false, onChange })))
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('focusModeToggleLabel')
    expect(toggle.textContent).toBe('')
    await act(async () => toggle.click())
    expect(onChange).toHaveBeenLastCalledWith(true)
    await act(async () => root.render(createElement(SidebarFocusModeSwitch, { enabled: true, onChange })))
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.title).toContain('switchOn')
  })

  it('keeps the original footer only for theme packs with sidebar scene chrome', async () => {
    let scene = false
    function Probe() {
      scene = useSidebarSceneFooter()
      return null
    }
    await act(async () => root.render(createElement(Probe)))
    expect(scene).toBe(false)
    const manifest = { id: 'pack', scene: { chrome: { sidebar: 'grand-line' } } }
    await act(async () => useUiPluginStore.setState({ uiMode: 'pack', activeRuntime: { manifest } as never }))
    expect(scene).toBe(true)
    await act(async () => useUiPluginStore.setState({ activeRuntime: { manifest: { ...manifest, scene: { chrome: { sidebar: 'inherit' } } } } as never }))
    expect(scene).toBe(false)
    await act(async () => useUiPluginStore.setState({ uiMode: 'default', activeRuntime: null }))
  })
})
