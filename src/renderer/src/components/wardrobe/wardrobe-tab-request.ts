import { create } from 'zustand'

/** Page tabs another surface can open directly; the account menu links to the shop and invitations. */
export type WardrobeTabRequest = 'items' | 'shop' | 'invite'

/**
 * The last tab someone asked the wardrobe page for. `serial` makes a repeated ask for the same
 * tab land again. It has no route dependency, so the page can read it without the chat store.
 */
export const useWardrobeTabRequest = create<{ request: { tab: WardrobeTabRequest; serial: number } | null }>(() => ({ request: null }))

export function requestWardrobeTab(tab: WardrobeTabRequest | undefined): void {
  useWardrobeTabRequest.setState((state) => ({ request: tab ? { tab, serial: (state.request?.serial ?? 0) + 1 } : null }))
}
