/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { closeWardrobePage, toggleWardrobePage, useWardrobeRoute, wardrobeReturnRouteFor } from './wardrobe-route'

const route = () => useChatStore.getState().route

describe('wardrobe page route', () => {
  beforeEach(() => {
    useChatStore.setState({ route: 'chat' })
    useWardrobeRoute.setState({ returnRoute: 'chat' })
  })

  it('opens from Work, keeps Work as the way back, and returns on a second click', () => {
    useChatStore.setState({ route: 'write' })
    toggleWardrobePage()
    expect(route()).toBe('wardrobe')
    expect(useWardrobeRoute.getState().returnRoute).toBe('write')
    toggleWardrobePage()
    expect(route()).toBe('write')
  })

  it('remembers where it came from on every way in, including a plain route change', () => {
    useChatStore.setState({ route: 'schedule' })
    useChatStore.getState().setRoute('wardrobe')
    closeWardrobePage()
    expect(route()).toBe('schedule')
  })

  it('goes back to Code from pages that are not workbench destinations', () => {
    expect(wardrobeReturnRouteFor('settings')).toBe('chat')
    expect(wardrobeReturnRouteFor('design')).toBe('chat')
    expect(wardrobeReturnRouteFor('rooms')).toBe('agent-chat')
    expect(wardrobeReturnRouteFor('board')).toBe('board')
  })
})
