import type { ReactElement } from 'react'
import { Check, Copy, ImagePlus, Link2, MessageSquare, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunInviteSummary } from '@shared/kun-account-economy'
import cheerArt from '../../../../asset/img/kun-account/cheer.webp'
import { WardrobeBottleIcon, type WardrobeBottleState } from '../rooms/RoomWardrobeBottle'
import { formatInviteCode } from './wardrobe-account'

export type InviteCopyKind = 'code' | 'link' | 'message'

function Bottles({ count, state }: { count: number; state: WardrobeBottleState }): ReactElement {
  return <span className="kun-wardrobe-invite-bottles" aria-hidden="true">
    {Array.from({ length: Math.min(Math.max(count, 1), 4) }, (_, index) => <WardrobeBottleIcon key={index} size={30} state={state} />)}
  </span>
}

/**
 * The share kit: what an invitation pays, the three ways to send it, and the invite code as a ticket
 * with the link under its tear line. Little Kun cheers on top of the ticket.
 */
export function WardrobeInviteHero({ summary, inviter, invitee, copied, shareReady, shareProblem, onCopy, onShare, onRetry }: {
  summary: KunInviteSummary; inviter: number; invitee: number; copied: InviteCopyKind | null
  shareReady: boolean; shareProblem: boolean
  onCopy: (kind: InviteCopyKind) => void; onShare: () => void; onRetry: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const icon = (kind: InviteCopyKind, Idle: typeof Copy) => copied === kind ? <Check size={15} aria-hidden="true" /> : <Idle size={15} aria-hidden="true" />
  return <section className="kun-wardrobe-invite-hero" data-wardrobe-invite-hero>
    <div className="kun-wardrobe-invite-pitch">
      <span className="kun-wardrobe-invite-chip"><UserPlus size={13} strokeWidth={2} aria-hidden="true" />{t('wardrobeInviteChip')}</span>
      <h2>{t('wardrobeInviteTitle', { n: inviter })}</h2>
      <p>{t('wardrobeInviteBody')}</p>
      <div className="kun-wardrobe-invite-rewards">
        <span data-reward="inviter"><Bottles count={inviter} state="glowing" />
          <span><b>{t('wardrobeInviteRewardYou', { n: inviter })}</b><small>{t('wardrobeInviteRewardYouHint')}</small></span></span>
        <span data-reward="invitee"><Bottles count={invitee} state="sealed" />
          <span><b>{t('wardrobeInviteRewardFriend', { n: invitee })}</b><small>{t('wardrobeInviteRewardFriendHint')}</small></span></span>
      </div>
    </div>
    <div className="kun-wardrobe-invite-actions">
      <button type="button" data-primary onClick={() => onCopy('link')} data-wardrobe-invite-link>
        {icon('link', Link2)}{copied === 'link' ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyLink')}</button>
      <button type="button" disabled={!shareReady} onClick={onShare} data-wardrobe-invite-share>
        <ImagePlus size={15} aria-hidden="true" />{t('wardrobeShare.title')}</button>
      <button type="button" data-text onClick={() => onCopy('message')} data-wardrobe-invite-message>
        {icon('message', MessageSquare)}{copied === 'message' ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyMessage')}</button>
      {shareProblem ? <p role="alert">{t('wardrobeShare.missing')} <button type="button" onClick={onRetry}>{t('wardrobeShare.retry')}</button></p> : null}
    </div>
    <div className="kun-wardrobe-invite-ticket-wrap">
      <img className="kun-wardrobe-invite-kun" src={cheerArt} alt="" draggable={false} />
      <div className="kun-wardrobe-invite-ticket-shadow">
        <div className="kun-wardrobe-invite-ticket">
          <div className="kun-wardrobe-invite-code">
            <small>{t('wardrobeInviteMyCode')}</small>
            <span>
              <b data-wardrobe-invite-code>{formatInviteCode(summary.code)}</b>
              <button type="button" onClick={() => onCopy('code')} aria-label={t('wardrobeInviteCopyCode')} title={t('wardrobeInviteCopyCode')}
                data-copied={copied === 'code' || undefined} data-wardrobe-invite-copy-code>{icon('code', Copy)}</button>
            </span>
          </div>
          <small className="kun-wardrobe-invite-url"><Link2 size={13} aria-hidden="true" /><span>{summary.link.replace(/^https?:\/\/(www\.)?/, '')}</span></small>
        </div>
      </div>
    </div>
  </section>
}
