import type { ReactElement } from 'react'
import { ChevronRight, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { inviteRewards, shelfInviteHint, useWardrobeInvites } from './wardrobe-invites'
import './wardrobe-invite.css'

/**
 * The shelf's way to more bottles: one row that opens the Invite tab. It waits for the invitation
 * summary (or its failure) so it never flashes numbers that then change, and leaves once this
 * month's invite rewards are used up.
 */
export function WardrobeShelfInvite({ count, tenPull, dailyFull, onInvite }: {
  count: number; tenPull: number; dailyFull: boolean; onInvite: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = useWardrobeInvites((state) => state.summary)
  const failed = useWardrobeInvites((state) => Boolean(state.error))
  if (!summary && !failed) return null
  const hint = shelfInviteHint(summary, { count, tenPull, dailyFull })
  if (!hint) return null
  return <button type="button" className="kun-wardrobe-shelf-invite" onClick={onInvite} data-shelf-invite={hint.key}>
    <span className="kun-wardrobe-shelf-invite-icon" aria-hidden="true"><UserPlus size={15} strokeWidth={2} /></span>
    <span className="kun-wardrobe-shelf-invite-text">
      <b>{t('wardrobeShelfInviteTitle', { n: inviteRewards(summary).inviter })}</b>
      <small>{t(hint.key, hint.values)}</small>
    </span>
    <ChevronRight className="kun-wardrobe-shelf-invite-arrow" size={15} strokeWidth={2} aria-hidden="true" />
  </button>
}
