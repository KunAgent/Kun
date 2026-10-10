import type { KunAvatarParts } from '@shared/rooms-api'
import { WardrobeSharePoster } from './WardrobeSharePoster'
import { posterQrContent } from './share-poster/share-poster-model'
import { useState, type FormEvent, type ReactElement } from 'react'
import { Check, Copy, Link2, ImagePlus, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunInviteSummary, KunReferral } from '@shared/kun-account-economy'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { accountResult } from '../rooms/room-wardrobe'
import { copyText, formatInviteCode, useAccountRead, wardrobeErrorText } from './wardrobe-account'

type Copied = 'code' | 'link' | 'message' | null

function day(value: string, language: 'zh' | 'en'): string {
  return new Date(value).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

/** The account's invite code and link, how the invitations went, and the code a new account may still enter. */
export function WardrobeInvitePanel({ language, onClaimed, look }: { look: KunAvatarParts; language: 'zh' | 'en'; onClaimed: (text: string) => void }): ReactElement {
  const { t } = useTranslation('common')
  const invites = useAccountRead((api) => api.invites(), true)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState<Copied>(null)
  const [code, setCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [failure, setFailure] = useState('')
  const summary = invites.value
  let validInvite = false
  try { validInvite = Boolean(summary && posterQrContent(summary.code, summary.link)) } catch { /* Retry the account read. */ }
  const inviterBottles = summary?.rewards.inviter.bottles ?? 3
  const inviteeBottles = summary?.rewards.invitee.bottles ?? 2

  const copy = async (kind: Exclude<Copied, null>, text: string) => {
    if (await copyText(text)) { setCopied(kind); setTimeout(() => setCopied((current) => current === kind ? null : current), 1800) }
  }
  const claim = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim() || claiming) return
    setClaiming(true)
    setFailure('')
    try {
      const next = await accountResult<KunInviteSummary>((api) => api.claimInvite(code.trim()))
      invites.setValue(next)
      setCode('')
      onClaimed(t(next.invitedBy?.status === 'rewarded' ? 'wardrobeInviteClaimedPaid' : 'wardrobeInviteClaimedPending', { n: inviteeBottles }))
    } catch (cause) { setFailure(wardrobeErrorText(t, cause)) }
    finally { setClaiming(false) }
  }
  const status = (referral: KunReferral) => t(referral.status === 'rewarded' ? 'wardrobeInviteRewarded'
    : referral.status === 'capped' ? 'wardrobeInviteCapped' : 'wardrobeInvitePending', { n: inviterBottles })

  if (!summary) {
    return <div className="kun-wardrobe-scroll kun-wardrobe-invite">
      {invites.error ? <p className="kun-wardrobe-shop-error" role="alert">{wardrobeErrorText(t, invites.error)}
        <button type="button" onClick={() => void invites.reload()}>{t('wardrobeAccountRetry')}</button></p>
        : <p className="kun-wardrobe-shop-note">{t('roomsLoading')}</p>}
    </div>
  }
  const left = summary.claimUntil ? Math.max(0, Math.ceil((Date.parse(summary.claimUntil) - Date.now()) / 86_400_000)) : 0
  const message = t('wardrobeInviteMessage', { link: summary.link, code: formatInviteCode(summary.code), n: inviteeBottles })
  return <div className="kun-wardrobe-scroll kun-wardrobe-invite" data-wardrobe-invite>
    {shareOpen ? <WardrobeSharePoster look={look} code={summary.code} link={summary.link} onClose={() => setShareOpen(false)} onRetry={() => void invites.reload()} /> : null}
    <section className="kun-wardrobe-invite-hero">
      <span className="kun-wardrobe-invite-chip">{t('wardrobeInviteChip')}</span>
      <strong>{t('wardrobeInviteTitle', { n: inviterBottles })}</strong>
      <p>{t('wardrobeInviteBody', { n: inviteeBottles })}</p>
      <div className="kun-wardrobe-invite-code">
        <span><small>{t('wardrobeInviteMyCode')}</small><b data-wardrobe-invite-code>{formatInviteCode(summary.code)}</b></span>
        <button type="button" onClick={() => void copy('code', summary.code)}>
          {copied === 'code' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied === 'code' ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyCode')}</button>
      </div>
      <div className="kun-wardrobe-invite-actions">
        <button type="button" data-primary onClick={() => void copy('link', summary.link)} data-wardrobe-invite-link>
          {copied === 'link' ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
          {copied === 'link' ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyLink')}</button>
        <button type="button" disabled={!validInvite || Boolean(invites.error)} onClick={() => setShareOpen(true)}>
          <ImagePlus size={15} aria-hidden="true" />{t('wardrobeShare.title')}</button>
      </div>
      {!validInvite || invites.error ? <p role="alert">{t('wardrobeShare.missing')} <button type="button" onClick={() => void invites.reload()}>{t('wardrobeShare.retry')}</button></p> : null}
      <small className="kun-wardrobe-invite-url">{summary.link.replace(/^https:\/\//, '')}</small>
    </section>
    <section className="kun-wardrobe-invite-card">

      <strong>{t('wardrobeInviteProgress')}</strong>
      <div className="kun-wardrobe-invite-stats">
        <span><b>{summary.invited}</b><small>{t('wardrobeInviteStatInvited')}</small></span>
        <span><b>{summary.rewarded}</b><small>{t('wardrobeInviteStatRewarded')}</small></span>
        <span><b>{summary.pending}</b><small>{t('wardrobeInviteStatPending')}</small></span>
        <span data-accent><b>{summary.monthlyRewarded}<small> / {summary.monthlyCap}</small></b><small>{t('wardrobeInviteStatMonthly')}</small></span>
      </div>
      {summary.recent.length ? <ul className="kun-wardrobe-invite-list">
        {summary.recent.map((referral, index) => <li key={`${referral.claimedAt}-${index}`} data-status={referral.status}>
          <WardrobeBottleIcon size={26} state="sealed" />
          <span className="kun-wardrobe-invite-friend">{t('wardrobeInviteFriend', { date: day(referral.claimedAt, language) })}</span>
          <em>{status(referral)}</em>
        </li>)}
      </ul> : <p className="kun-wardrobe-shop-note">{t('wardrobeInviteNone')}</p>}
      <button type="button" className="kun-wardrobe-invite-copy-message" onClick={() => void copy('message', message)}>
          {copied === 'message' ? <Check size={15} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />}
          {copied === 'message' ? t('wardrobeInviteCopied') : t('wardrobeInviteCopyMessage')}</button>
    </section>
    {summary.canClaim ? <form className="kun-wardrobe-invite-card" onSubmit={(event) => void claim(event)} data-wardrobe-invite-claim>
      <strong>{t('wardrobeInviteClaimTitle')}</strong>
      <small>{t('wardrobeInviteClaimBody', { n: inviteeBottles, days: left })}</small>
      <span className="kun-wardrobe-invite-field">
        <label className="sr-only" htmlFor="kun-invite-code">{t('wardrobeInviteClaimLabel')}</label>
        <input id="kun-invite-code" value={code} maxLength={16} autoComplete="off" spellCheck={false}
          placeholder={t('wardrobeInviteClaimPlaceholder')} onChange={(event) => { setCode(event.target.value.toUpperCase()); setFailure('') }} />
        <button type="submit" disabled={!code.trim() || claiming}>{claiming ? t('wardrobeShopBuying') : t('wardrobeInviteClaim')}</button>
      </span>
      {failure ? <p className="kun-wardrobe-shop-error" role="alert">{failure}</p> : null}
    </form> : summary.invitedBy ? <p className="kun-wardrobe-invite-card kun-wardrobe-invite-by">
      {t(summary.invitedBy.status === 'rewarded' ? 'wardrobeInviteByPaid' : 'wardrobeInviteByPending', { n: inviteeBottles })}</p> : null}
    <section className="kun-wardrobe-invite-card kun-wardrobe-invite-rules">
      <strong>{t('wardrobeInviteRulesTitle')}</strong>
      <ul>
        <li>{t('wardrobeInviteRuleNew')}</li>
        <li>{t('wardrobeInviteRuleActive')}</li>
        <li>{t('wardrobeInviteRuleCap', { n: summary.monthlyCap })}</li>
        <li>{t('wardrobeInviteRulePrivacy')}</li>
      </ul>
    </section>
  </div>
}
