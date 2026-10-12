import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GmailAuthorization, GmailConversationStatus, GmailConversationBinding, GmailLocalModelStatus } from '@shared/gmail-api'
import { gmailClient } from './gmail-client'
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

/** A human starts OAuth and grants model sharing; rendering never grants access. */
export function GmailConnectionCard({ binding, body, skipped = false, resumed = false, onContinue, onSkip }: Props) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<GmailConversationStatus | null>(null)
  const [local, setLocal] = useState<GmailLocalModelStatus | null>(null)
  const [attempt, setAttempt] = useState<GmailAuthorization | null>(null)
  const [sharing, setSharing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const generation = useRef(0)
  const bindingKey = binding.threadId ?? `${binding.roomId}:${binding.messageId}`
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const load = async (signal?: AbortSignal) => {
    const requestedBinding = bindingRef.current
    const next = await gmailClient.status(requestedBinding, signal)
    if (!signal?.aborted && JSON.stringify(requestedBinding) === JSON.stringify(bindingRef.current)) {
      setStatus(next); setSharing(next.allowModelSharing)
    }
    return next
  }
  const loadLocal = async (signal?: AbortSignal) => {
    const requestedBinding = bindingRef.current
    const next = await gmailClient.localStatus(requestedBinding, signal)
    if (!signal?.aborted && JSON.stringify(requestedBinding) === JSON.stringify(bindingRef.current)) setLocal(next)
    return next
  }
  useEffect(() => {
    const controller = new AbortController()
    setStatus(null); setLocal(null); setAttempt(null); setSharing(false); setError(''); setBusy(false); setConfirmRevoke(false)
    void load(controller.signal).catch(() => { if (!controller.signal.aborted) setError(t('gmailStatusFailed')) })
    void loadLocal(controller.signal).catch(() => undefined)
    return () => { controller.abort(); generation.current += 1 }
  // A scope identity change invalidates every in-flight view and consent checkbox.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingKey])
  useEffect(() => {
    if (!local?.preparing) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await loadLocal(controller.signal)
        if (controller.signal.aborted) return
        if (next.preparing) timer = setTimeout(() => void poll(), 1500)
        else if (next.ready) await load(controller.signal)
        else setError(t('gmailLocalPrepareFailed'))
      } catch {
        if (!controller.signal.aborted) {
          setError(t('gmailLocalPrepareFailed'))
          timer = setTimeout(() => void poll(), 1500)
        }
      }
    }
    timer = setTimeout(() => void poll(), 1500)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  // Only poll preparation started by a human, never install on render.
  }, [local?.preparing, bindingKey, t])
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
          if (next.status === 'connected') { await load(controller.signal); setError('') }
          else setError(t(next.status === 'cancelled' ? 'gmailCancelled' : next.status === 'expired' ? 'gmailExpired' : 'gmailAuthorizationFailed'))
        }
      } catch {
        if (!controller.signal.aborted) { setError(t('gmailPollFailed')); timer = setTimeout(() => void poll(), 1000) }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  // Only poll the attempt explicitly started by the current user.
  }, [attempt?.id, attempt?.status, bindingKey, t])
  const act = async (action: 'connect' | 'cancel' | 'disconnect' | 'revoke' | 'continue' | 'skip' | 'refresh' | 'prepare-local') => {
    if (busy) return
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      if (action === 'prepare-local') {
        const next = await gmailClient.prepareLocal(bindingRef.current)
        if (current === generation.current) {
          setLocal(next)
          if (next.ready) await load()
          else if (!next.preparing) setError(t('gmailLocalPrepareFailed'))
        }
      } else if (action === 'connect') {
        const next = await gmailClient.authorize(bindingRef.current, sharing && status?.modelSharingAvailable === true)
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
          else setError(t('gmailCancelled'))
        }
      } else if (action === 'disconnect' || action === 'revoke') {
        const next = await gmailClient.disconnect(bindingRef.current, action === 'revoke')
        if (current === generation.current) { setStatus(next); setSharing(false); setAttempt(null); setConfirmRevoke(false) }
      } else if (action === 'skip') {
        if (attempt?.status === 'pending') await gmailClient.cancel(bindingRef.current, attempt.id)
        await onSkip?.()
      } else if (action === 'continue') {
        const next = await load()
        if (!next.connected || !next.allowModelSharing || next.modelSharingAvailable !== true || !REQUIRED_SCOPES.every((scope) => next.scopes.includes(scope))) {
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
        await loadLocal().catch(() => undefined)
      }
    } catch { if (current === generation.current) setError(t('gmailActionFailed')) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const toggleSharing = async (value: boolean) => {
    if (busy) return
    if (!status?.connected) { setSharing(value); return }
    setBusy(true); setError('')
    const current = ++generation.current
    try {
      const next = await gmailClient.sharing(bindingRef.current, value)
      if (current === generation.current) {
        setStatus({ ...next, modelProviderName: next.modelProviderName ?? status?.modelProviderName,
          modelSharingAvailable: next.modelSharingAvailable ?? status?.modelSharingAvailable,
          modelSharingReason: next.modelSharingReason ?? status?.modelSharingReason })
        setSharing(next.allowModelSharing)
      }
    } catch { if (current === generation.current) setError(t('gmailActionFailed')) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const connected = status?.connected === true
  const pending = attempt?.status === 'pending'
  const sharingAvailable = status?.modelSharingAvailable === true
  const ready = connected && status.allowModelSharing && sharingAvailable && REQUIRED_SCOPES.every((scope) => status.scopes.includes(scope))
  return <section className="rooms-app-connection-card gmail-connection-card" aria-label={t('gmailTitle')} aria-busy={busy}>
    <div className="rooms-app-connection-hero"><span className="rooms-app-connection-icon"><Mail size={25} /></span></div>
    <div className="rooms-app-connection-content">
      <strong>{t(skipped ? 'gmailSkipped' : connected ? 'gmailConnected' : 'gmailTitle')}</strong>
      {body ? <p>{body}</p> : null}
      {connected && status.email ? <p className="gmail-connected-email">{status.email}</p> : null}
      <ul className="gmail-permissions"><li>{t('gmailReadPermission')}</li><li>{t('gmailSendPermission')}</li></ul>
      <small><ShieldCheck size={13} /> {t('gmailApprovalRequired')}</small>
      <small>{t('gmailLocalCredentials')}</small>
      {status?.modelProviderName ? <small>{t('gmailProvider', { name: status.modelProviderName })}</small> : null}
      {status && !sharingAvailable ? <p role="status">{t('gmailModelRestricted')}</p> : null}
      {local?.installed && !local.ready ? <div className="gmail-local-preparation">
        <small>{t('gmailLocalDownloadDetails')}</small>
        {local.preparing ? <p role="status" className="gmail-waiting"><Loader2 size={14} className="animate-spin" />{t('gmailLocalPreparing')}</p> :
          <div className="rooms-app-connection-actions"><button type="button" disabled={busy || pending} onClick={() => void act('prepare-local')}>{t('gmailPrepareLocal')}</button></div>}
      </div> : local?.ready && !sharingAvailable ? <small>{t('gmailLocalChooseNewTask')}</small> : null}
      {!skipped ? <label className="gmail-sharing-consent">
        <input type="checkbox" checked={sharing} disabled={busy || pending || !status?.configured || (!sharingAvailable && !sharing)} onChange={(event) => void toggleSharing(event.target.checked)} />
        <span>{t('gmailSharingConsent')}<small>{t('gmailSharingDetails')}</small></span>
      </label> : null}
      <small>{t('gmailSharingScope')}</small>
      <a className="rooms-app-connection-guide" href="https://www.kun-agent.com/privacy" target="_blank" rel="noreferrer"
        onClick={(event) => { if (window.kunGui?.openExternal) { event.preventDefault(); void window.kunGui.openExternal('https://www.kun-agent.com/privacy') } }}>{t('gmailPrivacy')}</a>
      {!status?.configured && status ? <p role="status">{t('gmailNotConfigured')}</p> : null}
      {status?.reconnectRequired ? <p role="status">{t('gmailReconnectRequired')}</p> : null}
      {pending ? <p role="status" className="gmail-waiting"><Loader2 size={14} className="animate-spin" />{t('gmailWaiting')}</p> : null}
      {error ? <p role="alert" className="rooms-app-connection-error">{error}</p> : null}
      {!skipped ? <div className="rooms-app-connection-actions gmail-actions">
        {pending ? <button type="button" disabled={busy} onClick={() => void act('cancel')}>{t('gmailCancel')}</button> : <>
          {onSkip && !resumed ? <button type="button" disabled={busy} onClick={() => void act('skip')}>{t('gmailSkip')}</button> : null}
          {!connected ? <button type="button" className="is-primary" disabled={busy || !status?.configured} onClick={() => void act('connect')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}{t('gmailConnectBrowser')}</button> : <>
            {onContinue && !resumed ? <button type="button" className="is-primary" disabled={busy || !ready} onClick={() => void act('continue')}>{t('gmailContinue')}</button> : null}
            <button type="button" disabled={busy} onClick={() => void act('disconnect')}>{t('gmailDisconnect')}</button>
            <button type="button" disabled={busy} onClick={() => void act('connect')}>{t('gmailSwitchAccount')}</button>
          </>}
        </>}
        <button type="button" disabled={busy} onClick={() => void act('refresh')}>{t('gmailRefresh')}</button>
      </div> : null}
      {connected ? <>
        <small>{t('gmailDisconnectDetails')}</small>
        <button type="button" className="gmail-revoke" disabled={busy} onClick={() => setConfirmRevoke(true)}>{t('gmailRevoke')}</button>
      </> : null}
      {confirmRevoke ? <div className="gmail-revoke-confirm" role="group" aria-label={t('gmailRevoke')}>
        <p>{t('gmailRevokeWarning')}</p><div className="rooms-app-connection-actions">
          <button type="button" disabled={busy} onClick={() => setConfirmRevoke(false)}>{t('gmailCancel')}</button>
          <button type="button" disabled={busy} onClick={() => void act('revoke')}>{t('gmailConfirmRevoke')}</button>
        </div></div> : null}
      {resumed && ready ? <span className="rooms-app-connection-done"><Check size={14} />{t('gmailReady')}</span> : null}
    </div>
  </section>
}
