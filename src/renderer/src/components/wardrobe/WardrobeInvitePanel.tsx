import type { KunAvatarParts } from '@shared/rooms-api'
import { WardrobeSharePoster } from './WardrobeSharePoster'
import { posterQrContent } from './share-poster/share-poster-model'
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Check, ChevronRight, Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunInviteSummary } from '@shared/kun-account-economy'
import { accountResult } from '../rooms/room-wardrobe'
import { copyText, formatInviteCode, wardrobeErrorText } from './wardrobe-account'
import { acceptWardrobeInvites, formatInviteInput, inviteRewards, loadWardrobeInvites, useWardrobeInvites } from './wardrobe-invites'
import { WardrobeInviteHero, type InviteCopyKind } from './WardrobeInviteHero'
import { WardrobeInviteProgress } from './WardrobeInviteProgress'
import './wardrobe-invite.css'

const STEPS = [1, 2, 3] as const

/**
 * The Invite tab: the share kit first, the code a new account may still enter, how an invitation
 * pays out, this month's progress with recent friends, and the rules folded away at the end.
 */
export function WardrobeInvitePanel({ language, onClaimed, look }: { look: KunAvatarParts; language: 'zh' | 'en'; onClaimed: (text: string) => void }): ReactElement {
  const { t } = useTranslation('common')
  const summary = useWardrobeInvites((state) => state.summary)
  const error = useWardrobeInvites((state) => state.error)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState<InviteCopyKind | null>(null)
  const [code, setCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [failure, setFailure] = useState('')
  // Entering the tab refreshes what the page read when it opened; what is on screen stays meanwhile.
  useEffect(() => { void loadWardrobeInvites() }, [])
  let validInvite = false
  try { validInvite = Boolean(summary && posterQrContent(summary.code, summary.link)) } catch { /* Retry the account read. */ }
  const { inviter, invitee } = inviteRewards(summary)

  if (!summary) {
    return <div className="kun-wardrobe-scroll kun-wardrobe-invite">
      {error ? <p className="kun-wardrobe-shop-error" role="alert">{wardrobeErrorText(t, error)}
        <button type="button" onClick={() => void loadWardrobeInvites()}>{t('wardrobeAccountRetry')}</button></p>
        : <p className="kun-wardrobe-shop-note">{t('roomsLoading')}</p>}
    </div>
  }
  const message = t('wardrobeInviteMessage', { link: summary.link, code: formatInviteCode(summary.code), n: invitee })
  const copy = async (kind: InviteCopyKind) => {
    const text = kind === 'code' ? summary.code : kind === 'link' ? summary.link : message
    if (await copyText(text)) { setCopied(kind); setTimeout(() => setCopied((current) => current === kind ? null : current), 1800) }
  }
  const claim = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim() || claiming) return
    setClaiming(true)
    setFailure('')
    try {
      const next = await accountResult<KunInviteSummary>((api) => api.claimInvite(code))
      acceptWardrobeInvites(next)
      setCode('')
      onClaimed(t(next.invitedBy?.status === 'rewarded' ? 'wardrobeInviteClaimedPaid' : 'wardrobeInviteClaimedPending', { n: inviteRewards(next).invitee }))
    } catch (cause) { setFailure(wardrobeErrorText(t, cause)) }
    finally { setClaiming(false) }
  }
  const left = summary.claimUntil ? Math.max(0, Math.ceil((Date.parse(summary.claimUntil) - Date.now()) / 86_400_000)) : 0
  return <div className="kun-wardrobe-scroll kun-wardrobe-invite" data-wardrobe-invite>
    {shareOpen ? <WardrobeSharePoster look={look} code={summary.code} link={summary.link} onClose={() => setShareOpen(false)} onRetry={() => void loadWardrobeInvites()} /> : null}
    <span className="sr-only" role="status" aria-live="polite">{copied ? t('wardrobeInviteCopied') : ''}</span>
    <WardrobeInviteHero summary={summary} inviter={inviter} invitee={invitee} copied={copied}
      shareReady={validInvite && !error} shareProblem={!validInvite || Boolean(error)}
      onCopy={(kind) => void copy(kind)} onShare={() => setShareOpen(true)} onRetry={() => void loadWardrobeInvites()} />
    {summary.canClaim ? <form className="kun-wardrobe-invite-card kun-wardrobe-invite-claim" onSubmit={(event) => void claim(event)} data-wardrobe-invite-claim>
      <div className="kun-wardrobe-invite-claim-head">
        <span className="kun-wardrobe-invite-claim-icon" aria-hidden="true"><Gift size={18} strokeWidth={1.9} /></span>
        <span><strong>{t('wardrobeInviteClaimTitle', { n: invitee })}</strong><small>{t('wardrobeInviteClaimBody')}</small></span>
        {summary.claimUntil ? <em>{t('wardrobeInviteClaimDaysLeft', { days: left })}</em> : null}
      </div>
      <span className="kun-wardrobe-invite-field">
        <label className="sr-only" htmlFor="kun-invite-code">{t('wardrobeInviteClaimLabel')}</label>
        <input id="kun-invite-code" value={code} maxLength={64} autoComplete="off" spellCheck={false}
          placeholder={t('wardrobeInviteClaimPlaceholder')} onChange={(event) => { setCode(formatInviteInput(event.target.value)); setFailure('') }} />
        <button type="submit" disabled={code.replace('-', '').length < 8 || claiming}>{claiming ? t('wardrobeShopBuying') : t('wardrobeInviteClaim')}</button>
      </span>
      {failure ? <p className="kun-wardrobe-shop-error" role="alert">{failure}</p> : null}
    </form> : summary.invitedBy ? <p className="kun-wardrobe-invite-card kun-wardrobe-invite-by" data-status={summary.invitedBy.status}>
      <span aria-hidden="true"><Check size={15} strokeWidth={2.4} /></span>
      {t(summary.invitedBy.status === 'rewarded' ? 'wardrobeInviteByPaid' : 'wardrobeInviteByPending', { n: invitee })}</p> : null}
    <ol className="kun-wardrobe-invite-steps" aria-label={t('wardrobeInviteStepsLabel')}>
      {STEPS.map((step) => <li key={step} data-step={step}>
        <b aria-hidden="true">{step}</b>
        <span><strong>{t(`wardrobeInviteStep${step}Title`)}</strong><small>{t(`wardrobeInviteStep${step}Body`)}</small></span>
      </li>)}
    </ol>
    <WardrobeInviteProgress summary={summary} inviter={inviter} invitee={invitee} language={language}
      copied={copied === 'message'} onCopyMessage={() => void copy('message')} />
    <details className="kun-wardrobe-invite-rules" data-wardrobe-invite-rules>
      <summary><ChevronRight size={15} strokeWidth={2} aria-hidden="true" /><strong>{t('wardrobeInviteRulesTitle')}</strong>
        <small>{t('wardrobeInviteRulesSummary', { n: summary.monthlyCap })}</small></summary>
      <ul>
        <li>{t('wardrobeInviteRuleNew')}</li>
        <li>{t('wardrobeInviteRuleActive')}</li>
        <li>{t('wardrobeInviteRuleCap', { n: summary.monthlyCap })}</li>
        <li>{t('wardrobeInviteRulePrivacy')}</li>
      </ul>
    </details>
  </div>
}
