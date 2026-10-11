/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KunInviteSummary } from '@shared/kun-account-economy'
import { WardrobeAccountError } from '../rooms/room-wardrobe'
import { invitePlankSlots } from './WardrobeInviteProgress'
import {
  acceptWardrobeInvites, formatInviteInput, inviteRewards, loadWardrobeInvites, resetWardrobeInvites, shelfInviteHint, useWardrobeInvites
} from './wardrobe-invites'

const inviteSummary = (patch: Partial<KunInviteSummary> = {}): KunInviteSummary => ({
  code: '2PFTWXJR', link: 'https://www.kun-agent.com/invite/2PFTWXJR', invited: 4, pending: 1, rewarded: 3, monthlyRewarded: 3, monthlyCap: 10,
  rewards: { inviter: { bottles: 3 }, invitee: { bottles: 2 } }, recent: [], invitedBy: null, canClaim: false, claimUntil: null, ...patch
})
const shelf = { count: 3, tenPull: 10, dailyFull: false }

describe('wardrobe invitations', () => {
  afterEach(() => {
    resetWardrobeInvites()
    Object.defineProperty(window, 'kunGui', { configurable: true, value: undefined })
  })

  it('picks the shelf hint by what helps most, and stays quiet once the month is paid out', () => {
    expect(shelfInviteHint(inviteSummary({ pending: 2 }), { ...shelf, dailyFull: true })).toEqual({ key: 'wardrobeShelfInvitePending', values: { n: 2 } })
    expect(shelfInviteHint(inviteSummary({ pending: 0 }), { ...shelf, dailyFull: true })?.key).toBe('wardrobeShelfInviteDailyFull')
    expect(shelfInviteHint(inviteSummary({ pending: 0 }), shelf)).toEqual({ key: 'wardrobeShelfInviteShort', values: { need: 7, friends: 3 } })
    expect(shelfInviteHint(inviteSummary({ pending: 0 }), { ...shelf, count: 9 })?.values).toEqual({ need: 1, friends: 1 })
    expect(shelfInviteHint(inviteSummary({ pending: 0 }), { ...shelf, count: 12 })?.key).toBe('wardrobeShelfInviteDefault')
    expect(shelfInviteHint(inviteSummary({ monthlyRewarded: 10 }), shelf)).toBeNull()
    expect(shelfInviteHint(inviteSummary({ rewards: { inviter: {}, invitee: { bottles: 2 } } }), shelf)).toBeNull()
    // A failed read still points at invitations, with the usual reward.
    expect(shelfInviteHint(null, shelf)).toEqual({ key: 'wardrobeShelfInviteShort', values: { need: 7, friends: 3 } })
    expect(inviteRewards(null)).toEqual({ inviter: 3, invitee: 2 })
  })

  it('reads a friend code from typing, pasting or a whole invite link', () => {
    expect(formatInviteInput('ab2c')).toBe('AB2C')
    expect(formatInviteInput('ab2cd3ef')).toBe('AB2C-D3EF')
    expect(formatInviteInput(' ab2c d3ef9 ')).toBe('AB2C-D3EF')
    expect(formatInviteInput('https://www.kun-agent.com/invite/Q8NR2KLA?from=poster')).toBe('Q8NR-2KLA')
  })

  it('lays this month out as paid, waiting and open bottles, ten to a plank', () => {
    expect(invitePlankSlots({ monthlyCap: 10, monthlyRewarded: 3, pending: 2 })).toEqual([
      ['paid', 'paid', 'paid', 'waiting', 'waiting', 'empty', 'empty', 'empty', 'empty', 'empty']
    ])
    expect(invitePlankSlots({ monthlyCap: 10, monthlyRewarded: 9, pending: 4 })[0]!.slice(8)).toEqual(['paid', 'waiting'])
    expect(invitePlankSlots({ monthlyCap: 12, monthlyRewarded: 0, pending: 0 }).map((row) => row.length)).toEqual([10, 2])
    expect(invitePlankSlots({ monthlyCap: 0, monthlyRewarded: 0, pending: 1 })).toEqual([])
  })

  it('loads the summary, reports a refused read, and lets a claim win over a read in flight', async () => {
    let answer: (value: unknown) => void = () => undefined
    const invites = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: inviteSummary() })
      .mockResolvedValueOnce({ ok: false, code: 'expired' })
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { kunAccount: { wardrobe: { invites } } } })
    await loadWardrobeInvites()
    expect(useWardrobeInvites.getState().summary?.code).toBe('2PFTWXJR')
    await loadWardrobeInvites()
    expect(useWardrobeInvites.getState().error).toBeInstanceOf(WardrobeAccountError)
    expect(useWardrobeInvites.getState().summary?.code).toBe('2PFTWXJR')
    const pending = loadWardrobeInvites()
    acceptWardrobeInvites(inviteSummary({ canClaim: false, invitedBy: { status: 'pending', claimedAt: '2026-10-10T00:00:00Z', qualifiedAt: null } }))
    answer({ ok: true, value: inviteSummary({ code: 'STALE000' }) })
    await pending
    expect(useWardrobeInvites.getState()).toMatchObject({ summary: { code: '2PFTWXJR', invitedBy: { status: 'pending' } }, error: null, loading: false })
  })
})
