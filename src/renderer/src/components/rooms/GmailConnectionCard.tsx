import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Loader2, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GmailAuthorization, GmailConversationStatus, GmailConversationBinding } from '@shared/gmail-api'
import { gmailClient } from './gmail-client'
import { GmailModelConsent, hasCurrentGmailModelConsent } from './GmailModelConsent'
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
type Action = 'connect' | 'cancel' | 'disconnect' | 'revoke' | 'continue' | 'skip' | 'refresh'

/** Only an explicit human action starts Google authorization or grants conversation access. */
export function GmailConnectionCard({ binding, body, skipped = false, resumed = false, onContinue, onSkip }: Props) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<GmailConversationStatus | null>(null)
  const [attempt, setAttempt] = useState<GmailAuthorization | null>(null)
  const [sharing, setSharing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const generation = useRef(0)
  const bindingKey = binding.threadId ?? `${binding.roomId}:${binding.messageId}`
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const load = async (signal?: AbortSignal) => {
    const requestedBinding = bindingRef.current
    const next = await gmailClient.status(requestedBinding, signal)
    if (!signal?.aborted && JSON.stringify(requestedBinding) === JSON.stringify(bindingRef.current)) {
      setStatus(next); setSharing(hasCurrentGmailModelConsent(next))
    }
    return next
  }
  useEffect(() => {
    const controller = new AbortController()
    setStatus(null); setAttempt(null); setSharing(false); setError(''); setNotice('')
    setBusy(false); setLoading(true); setConfirmRevoke(false)
    void load(controller.signal)
      .catch(() => { if (!controller.signal.aborted) setError(t('gmailStatusFailed')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); generation.current += 1 }
  // Scope changes reset the checkbox and invalidate pending view updates.
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
        if (next.status === 'pending') timer = setTimeout(() => void poll(), 1000)
        else {
          setAttempt(next)
          if (next.status === 'connected') { await load(controller.signal); setError(''); setNotice('') }
          else if (next.status === 'cancelled') { setError(''); setNotice(t('gmailCancelled')) }
          else setError(t(next.status === 'expired' ? 'gmailExpired' : 'gmailAuthorizationFailed'))
        }
      } catch {
        if (!controller.signal.aborted) { setError(t('gmailPollFailed')); timer = setTimeout(() => void poll(), 1000) }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [attempt?.id, attempt?.status, bindingKey, t])
  const act = async (action: Action) => {
    if (busy) return
    const current = ++generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'connect') {
        const next = await gmailClient.authorize(bindingRef.current, sharing)
        if (current === generation.current) {
          setAttempt(next)
          if (next.status === 'connected') await load()
          else if (next.status !== 'pending') setError(t('gmailAuthorizationFailed'))
        }
      } else if (action === 'cancel' && attempt) {
        const next = await gmailClient.cancel(bindingRef.current, attempt.id)
        if (current === generation.current) {
          setAttempt(next)
          if (next.status === 'connected') await load()
          else setNotice(t('gmailCancelled'))
        }
      } else if (action === 'disconnect' || action === 'revoke') {
        const next = await gmailClient.disconnect(bindingRef.current, action === 'revoke')
        if (current === generation.current) { setStatus(next); setSharing(false); setAttempt(null); setConfirmRevoke(false) }
      } else if (action === 'skip') {
        if (attempt?.status === 'pending') await gmailClient.cancel(bindingRef.current, attempt.id)
        if (current === generation.current) await onSkip?.()
      } else if (action === 'continue') {
        const next = await load()
        if (current !== generation.current) return
        if (!next.configured || !next.connected || !hasCurrentGmailModelConsent(next) || !REQUIRED_SCOPES.every((scope) => next.scopes.includes(scope))) {
          setError(t('gmailGrantRequired')); return
        }
        await onContinue?.()
      } else {
        if (attempt?.status === 'pending') {
          const next = await gmailClient.poll(bindingRef.current, attempt.id)
          if (current !== generation.current) return
          setAttempt(next)
          if (next.status !== 'connected' && next.status !== 'pending') setError(t('gmailAuthorizationFailed'))
        }
        await load()
      }
    } catch { if (current === generation.current) setError(t('gmailActionFailed')) }
    finally { if (current === generation.current) { setBusy(false); setLoading(false) } }
  }
  const toggleSharing = async (value: boolean) => {
    if (busy) return
    if (!status?.connected) { setSharing(value); return }
    setBusy(true); setError(''); setNotice('')
    const current = ++generation.current
    try {
      const next = await gmailClient.sharing(bindingRef.current, value)
      if (current === generation.current) { setStatus(next); setSharing(hasCurrentGmailModelConsent(next)) }
    } catch { if (current === generation.current) setError(t('gmailActionFailed')) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const connected = status?.connected === true
  const pending = attempt?.status === 'pending'
  const ready = status?.configured === true && connected && hasCurrentGmailModelConsent(status) && REQUIRED_SCOPES.every((scope) => status.scopes.includes(scope))
  const stateKey = loading ? 'gmailChecking' : skipped ? 'gmailSkipped' : pending ? 'gmailConnecting' : connected ? 'gmailConnectedStatus' : 'gmailDisconnectedStatus'
  const retrying = !!attempt && !pending && attempt.status !== 'connected'
  return <section className="rooms-app-connection-card gmail-connection-card" aria-label={t('gmailTitle')} aria-busy={loading || busy || pending}>
    <div className="rooms-app-connection-content">
      <div className="gmail-card-header">
        <span className="gmail-card-icon"><Mail size={21} /></span>
        <strong>{t('gmailTitle')}</strong>
        <span className={`gmail-status-badge${connected ? ' is-connected' : ''}`}>
          {loading || pending ? <Loader2 size={12} className="animate-spin" /> : connected ? <Check size={12} /> : null}{t(stateKey)}
        </span>
      </div>
      {body ? <p className="gmail-request-description">{body}</p> : <p>{t('gmailIntro')}</p>}
      {connected && status.email ? <p className="gmail-connected-email">{status.email}</p> : null}
      {!loading && status?.modelProviderName ? <small className="gmail-selected-model" title={status.modelProviderName}>{t('gmailProvider', { name: status.modelProviderName })}</small> : null}
      <ul className="gmail-permissions"><li>{t('gmailReadPermission')}</li><li>{t('gmailSendPermission')}</li></ul>
      <p className="gmail-send-approval"><ShieldCheck size={14} />{t('gmailApprovalRequired')}</p>
      <GmailModelConsent status={status} sharing={sharing} busy={busy} pending={pending} skipped={skipped}
        onChange={(value) => void toggleSharing(value)} />
      {!status?.configured && status ? <p role="status">{t('gmailNotConfigured')}</p> : null}
      {status?.reconnectRequired ? <p role="status">{t('gmailReconnectRequired')}</p> : null}
      {pending ? <p role="status" className="gmail-waiting"><Loader2 size={14} className="animate-spin" />{t('gmailWaiting')}</p> : null}
      {notice ? <p role="status" className="gmail-notice">{notice}</p> : null}
      {error ? <p role="alert" className="rooms-app-connection-error">{error}</p> : null}
      {!skipped ? <div className="rooms-app-connection-actions gmail-actions">
        {pending ? <button type="button" disabled={busy} onClick={() => void act('cancel')}>{t('gmailCancel')}</button> : <>
          {onSkip && !resumed ? <button type="button" disabled={busy} onClick={() => void act('skip')}>{t('gmailSkip')}</button> : null}
          {!connected ? <button type="button" className="is-primary" disabled={loading || busy || !status?.configured} onClick={() => void act('connect')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}{t(retrying ? 'gmailRetry' : 'gmailConnectBrowser')}</button> : null}
          {connected && onContinue && !resumed ? <button type="button" className="is-primary" disabled={busy || !ready} onClick={() => void act('continue')}>{t('gmailContinue')}</button> : null}
        </>}
        <button type="button" disabled={loading || busy} onClick={() => void act('refresh')}><RefreshCw size={14} />{t('gmailRefresh')}</button>
      </div> : null}
      {connected && !skipped ? <div className="gmail-connection-management">
        <button type="button" disabled={busy || pending} onClick={() => void act('connect')}>{t('gmailSwitchAccount')}</button>
        <button type="button" disabled={busy || pending} onClick={() => void act('disconnect')}>{t('gmailDisconnect')}</button>
      </div> : null}
      {connected && !skipped ? <details className="gmail-account-options">
        <summary>{t('gmailAccountOptions')}</summary>
        <small>{t('gmailDisconnectDetails')}</small>
        <button type="button" className="gmail-revoke" disabled={busy || pending} onClick={() => setConfirmRevoke(true)}>{t('gmailRevoke')}</button>
      </details> : null}
      {confirmRevoke ? <div className="gmail-revoke-confirm" role="group" aria-label={t('gmailRevoke')}>
        <p>{t('gmailRevokeWarning')}</p><div className="rooms-app-connection-actions">
          <button type="button" disabled={busy} onClick={() => setConfirmRevoke(false)}>{t('gmailCancel')}</button>
          <button type="button" disabled={busy} onClick={() => void act('revoke')}>{t('gmailConfirmRevoke')}</button>
        </div></div> : null}
      <div className="gmail-card-footer"><small>{t('gmailLocalCredentials')}</small>
        <a className="rooms-app-connection-guide" href="https://www.kun-agent.com/privacy" target="_blank" rel="noreferrer"
          onClick={(event) => { if (window.kunGui?.openExternal) { event.preventDefault(); void window.kunGui.openExternal('https://www.kun-agent.com/privacy') } }}>{t('gmailPrivacy')}</a>
      </div>
      {resumed && ready ? <span className="rooms-app-connection-done"><Check size={14} />{t('gmailReady')}</span> : null}
    </div>
  </section>
}
