import { create } from 'zustand'
import type { KunInviteSummary } from '@shared/kun-account-economy'
import { WardrobeAccountError } from '../rooms/room-wardrobe'

/** What an invitation pays when the summary has not arrived yet; Kunserve's campaigns say the same. */
export const DEFAULT_INVITE_REWARDS = { inviter: 3, invitee: 2 } as const

type InviteState = { summary: KunInviteSummary | null; error: unknown; loading: boolean }

/**
 * The account's invitation summary, shared by the Invite tab and the shelf's invite row so a claim
 * or a reload shows in both. The wardrobe page reads it once when it opens and drops it when it closes,
 * so another account never sees the previous one's code.
 */
export const useWardrobeInvites = create<InviteState>(() => ({ summary: null, error: null, loading: false }))
let serial = 0

export async function loadWardrobeInvites(): Promise<void> {
  const api = window.kunGui?.kunAccount?.wardrobe
  if (!api) return
  const version = ++serial
  useWardrobeInvites.setState({ loading: true })
  try {
    const result = await api.invites()
    if (version !== serial) return
    useWardrobeInvites.setState(result.ok ? { summary: result.value, error: null } : { error: new WardrobeAccountError(result.code) })
  } catch (cause) {
    if (version === serial) useWardrobeInvites.setState({ error: cause })
  } finally {
    if (version === serial) useWardrobeInvites.setState({ loading: false })
  }
}

/** A claim answers with the new summary; it also outdates any read still in flight. */
export function acceptWardrobeInvites(summary: KunInviteSummary): void {
  serial += 1
  useWardrobeInvites.setState({ summary, error: null, loading: false })
}

export function resetWardrobeInvites(): void {
  serial += 1
  useWardrobeInvites.setState({ summary: null, error: null, loading: false })
}

/** Bottles each side gets. A summary without bottles means that campaign is paused, so it pays nothing. */
export function inviteRewards(summary: KunInviteSummary | null): { inviter: number; invitee: number } {
  if (!summary) return { ...DEFAULT_INVITE_REWARDS }
  return { inviter: summary.rewards.inviter.bottles ?? 0, invitee: summary.rewards.invitee.bottles ?? 0 }
}

export type ShelfInviteHint = { key: string; values: Record<string, number> }

/**
 * The second line of the shelf's invite row, most useful first: friends already on the way, a full
 * day of drops (invite bottles skip the daily cap), how many invites cover a ten-pull, else how it pays.
 * Null once this month's invite rewards are used up or the campaign pays nothing: the row would
 * promise bottles that will not come.
 */
export function shelfInviteHint(summary: KunInviteSummary | null, shelf: { count: number; tenPull: number; dailyFull: boolean }): ShelfInviteHint | null {
  const { inviter } = inviteRewards(summary)
  if (inviter <= 0 || (summary && summary.monthlyRewarded >= summary.monthlyCap)) return null
  if (summary && summary.pending > 0) return { key: 'wardrobeShelfInvitePending', values: { n: summary.pending } }
  if (shelf.dailyFull) return { key: 'wardrobeShelfInviteDailyFull', values: {} }
  const need = shelf.tenPull - shelf.count
  if (shelf.tenPull > 0 && need > 0) {
    return { key: 'wardrobeShelfInviteShort', values: { need, friends: Math.ceil(need / inviter) } }
  }
  return { key: 'wardrobeShelfInviteDefault', values: {} }
}

/** What someone types or pastes as a friend's code: the code from an invite link, upper case, as XXXX-XXXX. */
export function formatInviteInput(value: string): string {
  const fromLink = /\/invite\/([^/?#\s]+)/i.exec(value)?.[1] ?? value
  const raw = fromLink.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}
