import type { ReactElement } from 'react'
import { Check, Clock3, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunInviteSummary, KunReferral } from '@shared/kun-account-economy'
import sleepArt from '../../../../asset/img/kun-account/sleep.webp'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'

type Slot = 'paid' | 'waiting' | 'empty'

/** One slot per monthly reward, ten to a plank: paid, still waiting on a friend's first use, or open. */
export function invitePlankSlots(summary: Pick<KunInviteSummary, 'monthlyCap' | 'monthlyRewarded' | 'pending'>): Slot[][] {
  const cap = Math.max(0, summary.monthlyCap)
  const paid = Math.min(cap, summary.monthlyRewarded)
  const waiting = Math.min(cap - paid, summary.pending)
  const slots = Array.from({ length: cap }, (_, index): Slot => index < paid ? 'paid' : index < paid + waiting ? 'waiting' : 'empty')
  return Array.from({ length: Math.ceil(cap / 10) }, (_, row) => slots.slice(row * 10, row * 10 + 10))
}

function day(value: string, language: 'zh' | 'en'): string {
  return new Date(value).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

/** This month's rewards as bottles on a plank, the three counts, and how each recent friend is doing. */
export function WardrobeInviteProgress({ summary, inviter, invitee, language, copied, onCopyMessage }: {
  summary: KunInviteSummary; inviter: number; invitee: number; language: 'zh' | 'en'
  copied: boolean; onCopyMessage: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const full = summary.monthlyCap > 0 && summary.monthlyRewarded >= summary.monthlyCap
  const pill = (referral: KunReferral) => referral.status === 'rewarded'
    ? <em data-tone="ok"><Check size={12} strokeWidth={2.4} aria-hidden="true" />{t('wardrobeInviteRewarded', { n: inviter })}</em>
    : referral.status === 'capped' ? <em>{t('wardrobeInviteCapped')}</em>
      : <em data-tone="wait">{t('wardrobeInviteOnTheWay', { n: inviter })}</em>
  return <section className="kun-wardrobe-invite-card kun-wardrobe-invite-progress" data-full={full || undefined} data-wardrobe-invite-progress>
    <div className="kun-wardrobe-invite-card-head">
      <strong>{t('wardrobeInviteProgress')}</strong>
      {full ? <em className="kun-wardrobe-invite-full">{t('wardrobeInviteMonthlyFull')} · {summary.monthlyRewarded} / {summary.monthlyCap}</em>
        : <span className="kun-wardrobe-invite-monthly" data-wardrobe-invite-monthly>{t('wardrobeInviteMonthlyLabel')}
          <b>{summary.monthlyRewarded}</b><small>/ {summary.monthlyCap}</small></span>}
    </div>
    {invitePlankSlots(summary).map((row, index) => <div key={index} className="kun-wardrobe-invite-plank" aria-hidden="true">
      {row.map((slot, cell) => <span key={cell} data-slot={slot}>
        <WardrobeBottleIcon size={32} state={slot === 'paid' ? 'glowing' : 'sealed'} />
        {slot === 'waiting' ? <i><Clock3 size={10} strokeWidth={2.4} /></i> : null}
      </span>)}
    </div>)}
    {full ? <p className="kun-wardrobe-invite-note">{t('wardrobeInviteMonthlyFullBody')}</p> : null}
    {summary.invited === 0 ? <div className="kun-wardrobe-invite-empty" data-wardrobe-invite-empty>
      <img src={sleepArt} alt="" draggable={false} />
      <span><strong>{t('wardrobeInviteEmptyTitle')}</strong><small>{t('wardrobeInviteNone', { n: inviter, m: invitee })}</small></span>
      <button type="button" onClick={onCopyMessage}>
        {copied ? <Check size={15} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />}
        {copied ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyMessage')}</button>
    </div> : <>
      <div className="kun-wardrobe-invite-stats">
        <span><b>{summary.invited}</b><small>{t('wardrobeInviteStatInvited')}</small></span>
        <span data-tone="ok"><b>{summary.rewarded}</b><small>{t('wardrobeInviteStatRewarded')}</small></span>
        <span><b>{summary.pending}</b><small>{t('wardrobeInviteStatPending')}</small></span>
        {full ? null : <small className="kun-wardrobe-invite-left">{t('wardrobeInviteMonthlyLeft', { n: Math.max(0, summary.monthlyCap - summary.monthlyRewarded) })}</small>}
      </div>
      {summary.recent.length ? <ul className="kun-wardrobe-invite-list">
        {summary.recent.map((referral, index) => <li key={`${referral.claimedAt}-${index}`} data-status={referral.status}>
          <span className="kun-wardrobe-invite-avatar"><WardrobeBottleIcon size={24} state={referral.status === 'rewarded' ? 'glowing' : 'sealed'} /></span>
          <span className="kun-wardrobe-invite-friend">
            <span>{t('wardrobeInviteFriend', { date: day(referral.claimedAt, language) })}</span>
            {referral.status === 'pending' ? <small><span className="kun-wardrobe-invite-track" aria-hidden="true"><i data-on /><u data-on /><i data-on /><u /><i /></span>
              {t('wardrobeInvitePending')}</small> : null}
          </span>
          {pill(referral)}
        </li>)}
      </ul> : null}
    </>}
  </section>
}
