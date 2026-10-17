import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GmailAuthorization, GmailConversationStatus, GmailConversationBinding } from '@shared/gmail-api'
import { gmailClient } from './gmail-client'
import { GmailAccountMenu } from './GmailAccountMenu'
import { GmailLogo, GoogleGLogo } from './gmail-brand'
import { GmailConsentNote, hasCurrentGmailModelConsent } from './GmailModelConsent'
import './rooms-app-connections.css'
import './gmail-connections.css'

type Props = {
  binding: GmailConversationBinding
  body?: string
  skipped?: boolean
  resumed?: boolean
  onContinue?: () => Promise<void>
  onSkip?: () => Promise<void>
}
const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']
type Action = 'connect' | 'switch' | 'grant' | 'stop' | 'cancel' | 'disconnect' | 'revoke' | 'continue' | 'skip' | 'refresh'

const hasScopes = (status: GmailConversationStatus | null) => REQUIRED_SCOPES.every((scope) => status?.scopes.includes(scope))
const isReady = (status: GmailConversationStatus | null) =>
  status?.configured === true && status.connected && hasCurrentGmailModelConsent(status) && hasScopes(status)

/**
 * One explicit human click signs in to Google and allows this conversation; the consent text sits beside
 * that button. Nothing authorizes or grants access on mount, and the task resumes only after a fresh check.
 */
export function GmailConnectionCard({ binding, body, skipped = false, resumed = false, onContinue, onSkip }: Props) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<GmailConversationStatus | null>(null)
  const [attempt, setAttempt] = useState<GmailAuthorization | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const generation = useRef(0)
  const resumeAfterAuthorization = useRef(false)
  const bindingKey = binding.threadId ?? `${binding.roomId}:${binding.messageId}`
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const continueRef = useRef({ onContinue, resumed })
  continueRef.current = { onContinue, resumed }
  const load = async (signal?: AbortSignal) => {
    const requestedBinding = bindingRef.current
    const next = await gmailClient.status(requestedBinding, signal)
    if (!signal?.aborted && JSON.stringify(requestedBinding) === JSON.stringify(bindingRef.current)) setStatus(next)
    return next
  }
  /** Re-reads account, scopes and grant before resuming the recorded task. */
  const resume = async (signal?: AbortSignal, isCurrent = () => true) => {
    try {
      const next = await load(signal)
      if (signal?.aborted || !isCurrent()) return
      if (!isReady(next)) {
        // Missing scopes already show the reconnect banner; only a missing grant needs its own message.
        if (next.connected && hasScopes(next)) setError(t('gmailGrantRequired'))
        return
      }
      const { onContinue: run, resumed: done } = continueRef.current
      if (run && !done) await run()
    } catch { if (!signal?.aborted && isCurrent()) setError(t('gmailActionFailed')) }
  }
  useEffect(() => {
    const controller = new AbortController()
    setStatus(null); setAttempt(null); setError(''); setNotice('')
    setBusy(false); setLoading(true); setMenuOpen(false); setConfirmRevoke(false)
    resumeAfterAuthorization.current = false
    void load(controller.signal)
      .catch(() => { if (!controller.signal.aborted) setError(t('gmailStatusFailed')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); generation.current += 1 }
  // Scope changes reset the card and invalidate pending view updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingKey])
  useEffect(() => {
    if (attempt?.status !== 'pending') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await gmailClient.poll(bindingRef.current, attempt.id, controller.signal)
        if (controller.signal.aborted) return
        if (next.status === 'pending') { timer = setTimeout(() => void poll(), 1000); return }
        if (next.status === 'connected') {
          // Finish the follow-up before recording the attempt: a new attempt status re-runs this effect
          // and aborts its signal, and the waiting bar stays up while the task resumes.
          setError(''); setNotice('')
          if (resumeAfterAuthorization.current) {
            resumeAfterAuthorization.current = false
            setBusy(true)
            try { await resume(controller.signal) } finally { if (!controller.signal.aborted) setBusy(false) }
          } else await load(controller.signal)
          if (controller.signal.aborted) return
        } else if (next.status === 'cancelled') { setError(''); setNotice(t('gmailCancelled')) }
        else setError(t(next.status === 'expired' ? 'gmailExpired' : 'gmailAuthorizationFailed'))
        setAttempt(next)
      } catch {
        if (!controller.signal.aborted) { setError(t('gmailPollFailed')); timer = setTimeout(() => void poll(), 1000) }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  // The poll only follows the explicit attempt; resume reads the latest props through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.id, attempt?.status, bindingKey, t])
  const act = async (action: Action) => {
    if (busy) return
    const current = ++generation.current
    const isCurrent = () => current === generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'connect' || action === 'switch') {
        // Connecting is the conversation grant; switching accounts keeps whatever grant already exists.
        const allow = action === 'connect' || hasCurrentGmailModelConsent(status)
        resumeAfterAuthorization.current = action === 'connect'
        const next = await gmailClient.authorize(bindingRef.current, allow)
        if (isCurrent()) {
          setAttempt(next); setMenuOpen(false); setConfirmRevoke(false)
          if (next.status === 'connected') {
            resumeAfterAuthorization.current = false
            if (action === 'connect') await resume(undefined, isCurrent)
            else await load()
          } else if (next.status !== 'pending') setError(t('gmailAuthorizationFailed'))
        }
      } else if (action === 'grant' || action === 'stop') {
        const next = await gmailClient.sharing(bindingRef.current, action === 'grant')
        if (isCurrent()) {
          setStatus(next); setMenuOpen(false)
          if (action === 'grant') await resume(undefined, isCurrent)
        }
      } else if (action === 'cancel' && attempt) {
        resumeAfterAuthorization.current = false
        const next = await gmailClient.cancel(bindingRef.current, attempt.id)
        if (isCurrent()) {
          setAttempt(next)
          if (next.status === 'connected') await load()
          else setNotice(t('gmailCancelled'))
        }
      } else if (action === 'disconnect' || action === 'revoke') {
        const next = await gmailClient.disconnect(bindingRef.current, action === 'revoke')
        if (isCurrent()) { setStatus(next); setAttempt(null); setMenuOpen(false); setConfirmRevoke(false) }
      } else if (action === 'skip') {
        if (attempt?.status === 'pending') await gmailClient.cancel(bindingRef.current, attempt.id)
        if (isCurrent()) await onSkip?.()
      } else if (action === 'continue') {
        await resume(undefined, isCurrent)
      } else if (action === 'refresh') {
        if (attempt?.status === 'pending') {
          const next = await gmailClient.poll(bindingRef.current, attempt.id)
          if (!isCurrent()) return
          setAttempt(next)
          if (next.status !== 'connected' && next.status !== 'pending') setError(t('gmailAuthorizationFailed'))
        }
        await load()
      }
    } catch { if (isCurrent()) setError(t('gmailActionFailed')) }
    finally { if (isCurrent()) { setBusy(false); setLoading(false) } }
  }
  const connected = status?.connected === true
  const pending = attempt?.status === 'pending'
  const ready = isReady(status)
  const needsScopes = connected && !hasScopes(status)
  const linked = connected && !needsScopes && !hasCurrentGmailModelConsent(status)
  const unavailable = !loading && status !== null && !status.configured
  const retrying = (!!attempt && !pending && attempt.status !== 'connected') || status?.reconnectRequired === true || needsScopes
  const banner = unavailable ? 'gmailNotConfigured' : status?.reconnectRequired ? 'gmailReconnectRequired' : needsScopes ? 'gmailScopesMissing' : ''
  const toggleMenu = () => { setMenuOpen(!menuOpen); setConfirmRevoke(false) }
  const menu = menuOpen ? <GmailAccountMenu busy={busy || pending} canStop={ready} confirmRevoke={confirmRevoke}
    onSwitch={() => void act('switch')} onStop={() => void act('stop')} onDisconnect={() => void act('disconnect')}
    onAskRevoke={() => setConfirmRevoke(true)} onCancelRevoke={() => setConfirmRevoke(false)} onRevoke={() => void act('revoke')} /> : null
  const alert = error ? <p role="alert" className="gmail-alert"><CircleAlert size={14} /><span>{error}</span>
    <button type="button" className="gmail-link-button" disabled={loading || busy} onClick={() => void act('refresh')}>{t('gmailRefresh')}</button></p> : null
  const manageButton = <button type="button" className="gmail-manage-button" aria-expanded={menuOpen} onClick={toggleMenu}>
    {t('gmailManage')}<ChevronDown size={14} className={menuOpen ? 'is-open' : undefined} /></button>

  if (skipped || (ready && !pending)) {
    return <section className="rooms-app-connection-card gmail-connection-card is-compact" aria-label={t('gmailTitle')} aria-busy={busy}>
      <div className="gmail-compact">
        <span className={`gmail-logo-tile is-small${skipped ? ' is-muted' : ''}`}><GmailLogo size={20} /></span>
        <span className="gmail-compact-text">
          <strong>{t(skipped ? 'gmailSkipped' : 'gmailConnected')}{skipped ? null : <Check size={14} strokeWidth={2.5} />}</strong>
          <small>{skipped ? t('gmailSkippedDetails') : [status?.email, t('gmailReadyDetails')].filter(Boolean).join(' · ')}</small>
        </span>
        {!skipped && onContinue && !resumed ? <button type="button" className="gmail-primary-button is-small" disabled={busy} onClick={() => void act('continue')}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}{t('gmailContinue')}</button> : null}
        {skipped ? null : manageButton}
      </div>
      {skipped ? null : menu}
      {alert ? <div className="gmail-compact-alert">{alert}</div> : null}
    </section>
  }
  return <section className="rooms-app-connection-card gmail-connection-card" aria-label={t('gmailTitle')} aria-busy={loading || busy || pending}>
    <div className="gmail-card-main">
      <span className="gmail-logo-tile"><GmailLogo size={22} /></span>
      <span className="gmail-card-heading">
        <strong>{t('gmailTitle')}</strong>
        <span>{linked && status?.email ? t('gmailLinkedIntro', { email: status.email }) : t('gmailIntro')}</span>
      </span>
    </div>
    {body ? <p className="gmail-request-description">{body}</p> : null}
    {banner ? <p role="status" className="gmail-banner"><CircleAlert size={14} />{t(banner)}</p> : null}
    {notice ? <p role="status" className="gmail-notice">{notice}</p> : null}
    {alert}
    {pending ? <div role="status" className="gmail-waiting">
      <Loader2 size={15} className="animate-spin" /><span>{t('gmailWaiting')}</span>
      <button type="button" className="gmail-ghost-button" disabled={busy} onClick={() => void act('cancel')}>{t('gmailCancel')}</button>
    </div> : <div className="gmail-actions">
      {linked ? <button type="button" className="gmail-primary-button" disabled={busy} onClick={() => void act('grant')}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}{t('gmailGrant')}</button>
        : <button type="button" className="gmail-google-button" disabled={loading || busy || !status?.configured} onClick={() => void act('connect')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <GoogleGLogo />}{t(retrying ? 'gmailRetry' : 'gmailConnectBrowser')}</button>}
      {loading ? <span className="gmail-checking"><Loader2 size={13} className="animate-spin" />{t('gmailChecking')}</span> : null}
      {linked ? manageButton : null}
      {onSkip && !resumed ? <button type="button" className="gmail-link-button is-muted" disabled={busy} onClick={() => void act('skip')}>{t('gmailSkip')}</button> : null}
    </div>}
    {linked ? menu : null}
    <GmailConsentNote status={status} granting={linked} />
  </section>
}
