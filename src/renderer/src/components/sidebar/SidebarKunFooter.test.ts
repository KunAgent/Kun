/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import { acceptRoomUserProfile, useRoomUserProfile } from '../rooms/room-user-profile'
import { acceptWardrobe } from '../rooms/room-wardrobe'
import { useWardrobeRoute } from '../wardrobe/wardrobe-route'
import { createKunWardrobe, type KunWardrobeDrop } from '@shared/rooms-api'
import { serverPolicy } from '../../../../../kun/src/test-support/server-policy'
import { SidebarFocusModeSwitch, SidebarKunStatus, useSidebarSceneFooter } from './SidebarKunFooter'

const roomsRequest = vi.hoisted(() => vi.fn())
vi.mock('../rooms/rooms-client', () => ({ roomsRequest }))

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
    roomsRequest.mockReset()
    roomsRequest.mockRejectedValue(new Error('offline'))
    useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
    acceptWardrobe({ wardrobe: createKunWardrobe(1), revision: 1, mode: 'account' })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
  })

  it('shows the runtime state beside the Kun face and calls a custom open handler', async () => {
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

  it('opens the wardrobe page, shows it selected, and goes back on a second click', async () => {
    useChatStore.setState({ route: 'write' })
    useWardrobeRoute.setState({ returnRoute: 'chat' })
    await act(async () => root.render(createElement(SidebarKunStatus)))
    const button = container.querySelector<HTMLButtonElement>('.ds-sidebar-kun-status')!
    expect(button.title).toBe('sidebarKunStatusOpen')
    await act(async () => button.click())
    expect(useChatStore.getState().route).toBe('wardrobe')
    expect(button.dataset.active).toBe('true')
    expect(button.getAttribute('aria-current')).toBe('page')
    await act(async () => button.click())
    expect(useChatStore.getState().route).toBe('write')
    expect(button.dataset.active).toBeUndefined()
  })

  it('carries the bottles waiting on the shelf, gold once a ten-pull is ready', async () => {
    const drop = (index: number): KunWardrobeDrop => ({ id: `drop-${index}`, kind: 'item', rarity: 'common', item: { category: 'prop', id: 'book' },
      duplicate: false, feathers: 0, runId: `run-${index}`, createdAt: new Date(2026, 9, 10, 9, index).toISOString() })
    // "Ready" means the server's ten-pull size is reached, so the wardrobe carries the server's policy.
    const wardrobe = { ...createKunWardrobe(1), progress: serverPolicy() }
    await act(async () => acceptWardrobe({ wardrobe: { ...wardrobe, pending: [1, 2, 3].map(drop) }, revision: 1 }))
    await act(async () => root.render(createElement(SidebarKunStatus)))
    const badge = () => container.querySelector<HTMLElement>('[data-sidebar-bottles]')
    expect(badge()?.dataset.sidebarBottles).toBe('3')
    expect(badge()?.dataset.ready).toBeUndefined()
    await act(async () => acceptWardrobe({ wardrobe: { ...wardrobe, pending: Array.from({ length: 11 }, (_, index) => drop(index)) }, revision: 2 }))
    expect(badge()?.dataset.ready).toBe('true')
    expect(badge()?.textContent).toContain('wardrobePageBadgeReady')
    await act(async () => acceptWardrobe({ wardrobe, revision: 3 }))
    expect(badge()).toBeNull()
  })

  it('shows the avatar the user dresses and follows every change to it', async () => {
    roomsRequest.mockResolvedValue({ profile: { avatar: { kind: 'builtin', id: 'explorer' } }, revision: 2 })
    await act(async () => root.render(createElement(SidebarKunStatus, { onOpen: vi.fn() })))
    const face = () => container.querySelector('.ds-sidebar-kun-face [data-avatar-id]')?.getAttribute('data-avatar-id')
    expect(roomsRequest).toHaveBeenCalledWith('/v1/rooms/user-profile', 'GET', undefined, expect.any(AbortSignal))
    expect(face()).toBe('explorer')
    await act(async () => acceptRoomUserProfile({ profile: { avatar: { kind: 'builtin', id: 'designer' } }, revision: 3 }))
    expect(face()).toBe('designer')
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
  it('shows the default Kun while signed out even when an old profile look is cached', async () => {
    acceptWardrobe({ wardrobe: createKunWardrobe(1), revision: 2, mode: 'guest' })
    roomsRequest.mockResolvedValue({ profile: { avatar: { kind: 'builtin', id: 'designer' } }, revision: 3 })
    await act(async () => root.render(createElement(SidebarKunStatus)))
    expect(container.querySelector('.ds-sidebar-kun-face [data-avatar-id]')).toBeNull()
    expect(container.querySelector('[data-sidebar-bottles]')).toBeNull()
  })

})
