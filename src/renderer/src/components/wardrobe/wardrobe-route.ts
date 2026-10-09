import { create } from 'zustand'
import { useChatStore } from '../../store/chat-store'
import type { AppRoute } from '../../store/chat-store-types'

export type WardrobeReturnRoute = Exclude<AppRoute, 'wardrobe' | 'settings' | 'design' | 'rooms'>

/** Where the wardrobe page goes back to; its sidebar stays the one the user came from. */
export const useWardrobeRoute = create<{ returnRoute: WardrobeReturnRoute }>(() => ({ returnRoute: 'chat' }))

export function wardrobeReturnRouteFor(route: AppRoute): WardrobeReturnRoute {
  if (route === 'rooms') return 'agent-chat'
  if (route === 'wardrobe' || route === 'settings' || route === 'design') return 'chat'
  return route
}

// Every way in (the avatar card, the panel, the command palette) remembers where it came from.
useChatStore.subscribe((state, previous) => {
  if (state.route === 'wardrobe' && previous.route !== 'wardrobe') {
    useWardrobeRoute.setState({ returnRoute: wardrobeReturnRouteFor(previous.route) })
  }
})

export function openWardrobePage(): void {
  useChatStore.getState().setRoute('wardrobe')
}

export function closeWardrobePage(): void {
  const { route, setRoute } = useChatStore.getState()
  if (route === 'wardrobe') setRoute(useWardrobeRoute.getState().returnRoute)
}

/** The sidebar avatar card: opens the page, and a second click goes back to where the user was. */
export function toggleWardrobePage(): void {
  if (useChatStore.getState().route === 'wardrobe') closeWardrobePage()
  else openWardrobePage()
}
