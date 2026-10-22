import { useEffect, useRef, useState } from 'react'
import { Check, Github, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { githubReady, type GitHubBinding, type GitHubConnectionStatus, type GitHubAuthorization } from '@shared/github-app-api'
import { githubAppClient as client } from './github-app-client'
import './rooms-app-connections.css'
import './gmail-connections.css'

type Props = { binding: GitHubBinding; body?: string; skipped?: boolean; resumed?: boolean
  onContinue?: () => Promise<boolean | void>; onSkip?: () => Promise<void> }

/** Remount on binding changes so callbacks and delayed responses never cross conversations. */
export function GitHubConnectionCard(props: Props) {
  return <BoundGitHubCard key={JSON.stringify(props.binding)} {...props} />
}
function BoundGitHubCard({ binding, body, skipped, resumed, onContinue, onSkip }: Props) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null)
  const [flow, setFlow] = useState<GitHubAuthorization | null>(null)
  const [watch, setWatch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [details, setDetails] = useState(false)
  const live = useRef(true), auto = useRef(false), continuing = useRef(false), continued = useRef(false)
  const installOpened = useRef(false), deadline = useRef(0)
  const callback = useRef(onContinue); callback.current = onContinue
  const shownResumed = useRef(resumed); shownResumed.current = resumed
  const resume = async (next: GitHubConnectionStatus) => {
    if (!live.current || !githubReady(next) || !callback.current || continuing.current || continued.current || shownResumed.current) return
    continuing.current = true
    try {
      const done = await callback.current()
      if (!live.current) return
      if (done === false) { setWatch(true); return }
      continued.current = true; auto.current = false; setWatch(false)
    } finally { continuing.current = false }
  }
  useEffect(() => {
    live.current = true
    const controller = new AbortController()
    void client.status(binding, controller.signal).then((next) => {
      if (!live.current || controller.signal.aborted) return
      setStatus(next)
      if (next.pendingAuthorization?.status === 'pending') {
        setFlow(next.pendingAuthorization); auto.current = true
        deadline.current = Date.parse(next.pendingAuthorization.expiresAt); setWatch(true)
      }
    }, () => { if (live.current && !controller.signal.aborted) setError(t('githubStatusFailed')) })
    return () => { live.current = false; controller.abort() }
    // BoundGitHubCard is keyed by this immutable binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!watch || skipped || resumed) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        if (Date.now() > deadline.current) { setWatch(false); auto.current = false; setError(t('githubExpired')); return }
        if (flow?.status === 'pending') {
          const result = await client.poll(binding, flow.id, controller.signal)
          if (controller.signal.aborted || !live.current) return
          setFlow(result)
          if (['failed', 'expired', 'cancelled'].includes(result.status)) {
            auto.current = false; setWatch(false); setError(t(result.status === 'cancelled' ? 'githubCancelled' : 'githubAuthorizationFailed')); return
          }
          if (result.status === 'pending') return
        }
        const next = await client.status(binding, controller.signal)
        if (controller.signal.aborted || !live.current) return
        setStatus(next)
        if (githubReady(next) && auto.current) await resume(next)
        else if (next.connected && next.allowModelSharing && next.repositoryCount === 0 && !installOpened.current) {
          installOpened.current = true
          await client.repositories(binding)
        }
      } catch {
        if (!controller.signal.aborted && live.current) setError(t('githubRetryHint'))
      } finally {
        if (!controller.signal.aborted && live.current) timer = setTimeout(() => void poll(), 2000)
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
    // The polling loop restarts only when its authorization state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch, flow?.id, flow?.status, skipped, resumed])
  const act = async (action: 'connect' | 'grant' | 'cancel' | 'repositories' | 'disconnect' | 'stop' | 'continue' | 'skip' | 'refresh') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (['cancel', 'disconnect', 'stop', 'skip'].includes(action)) { auto.current = false; setWatch(false) }
      if (action === 'connect') {
        auto.current = true; installOpened.current = false
        const result = await client.authorize(binding)
        if (!live.current) return
        setFlow(result); deadline.current = Date.parse(result.expiresAt); setWatch(result.status === 'pending')
      } else if (action === 'grant') {
        const next = await client.sharing(binding, true)
        if (!live.current) return
        setStatus(next); auto.current = true; deadline.current = Date.now() + 600000
        if (githubReady(next)) await resume(next)
        else setWatch(true)
      } else if (action === 'cancel' && flow) { setFlow(await client.cancel(binding, flow.id)) }
      else if (action === 'disconnect') { setStatus(await client.disconnect(binding)); setFlow(null) }
      else if (action === 'stop') { setStatus(await client.sharing(binding, false)); setFlow(null) }
      else if (action === 'repositories') {
        await client.repositories(binding); installOpened.current = true; auto.current = true
        deadline.current = Date.now() + 600000; setWatch(true)
      } else if (action === 'skip') {
        if (flow?.status === 'pending') await client.cancel(binding, flow.id)
        await onSkip?.()
      } else {
        const next = await client.status(binding)
        if (!live.current) return
        setStatus(next)
        if (action === 'continue') { auto.current = true; deadline.current = Date.now() + 600000; await resume(next) }
      }
    } catch { if (live.current) setError(t('githubActionFailed')) }
    finally { if (live.current) setBusy(false) }
  }
  const ready = status && githubReady(status), pending = flow?.status === 'pending'
  const compact = ready || skipped
  const button = (label: string, action: Parameters<typeof act>[0], primary = false) =>
    <button type="button" className={primary ? 'gmail-primary-button' : 'gmail-ghost-button'} disabled={busy}
      onClick={() => void act(action)}>{busy && primary ? <Loader2 size={14} className="animate-spin" /> : null}{t(label)}</button>
  return <section className={`rooms-app-connection-card gmail-connection-card${compact ? ' is-compact' : ''}`}
    aria-label={t('githubTitle')} aria-busy={busy || pending}>
    <div className={compact ? 'gmail-compact' : 'gmail-card-main'}>
      <span className="gmail-logo-tile"><Github size={24} /></span>
      <span className={compact ? 'gmail-compact-text' : 'gmail-card-heading'}>
        <strong>{t(skipped ? 'githubSkipped' : ready ? 'githubConnected' : 'githubTitle')}{ready ? <Check size={14} /> : null}</strong>
        <small>{status?.login ? `@${status.login} · ${t('githubRepositories', { count: status.repositoryCount })}` : t('githubIntro')}</small>
      </span>
      {ready && onContinue && !resumed && !continued.current ? button('githubContinue', 'continue', true) : null}
      {status?.connected ? <button type="button" className="gmail-manage-button" aria-expanded={menu} onClick={() => setMenu(!menu)}>{t('githubManage')}</button> : null}
    </div>
    {body && !compact ? <p className="gmail-request-description">{body}</p> : null}
    {!status && !error ? <p role="status"><Loader2 size={14} className="animate-spin" />{t('githubLoading')}</p> : null}
    {status && !status.configured ? <p role="status" className="gmail-banner">{t('githubNotConfigured')}</p> : null}
    {error ? <p role="alert" className="gmail-alert">{error} {button('githubRefresh', 'refresh')}</p> : null}
    {pending ? <div role="status" className="gmail-waiting"><Loader2 size={15} className="animate-spin" />{t('githubWaiting')}{button('githubCancel', 'cancel')}</div> : null}
    {!compact && !pending && status?.configured ? <>
      {status.connected && status.allowModelSharing && !status.repositoryCount ?
        <p role="status" className="gmail-banner">{t('githubChooseHint')}</p> : null}
      <div className="gmail-consent-note"><span>{t('githubConsent')}</span>{' '}
        <button type="button" className="gmail-link-button" aria-expanded={details} onClick={() => setDetails(!details)}>{t('githubDetails')}</button>
        {details ? <p>{t('githubDataPolicy')}</p> : null}</div>
      <div className="gmail-actions">
        {onSkip ? button('githubSkip', 'skip') : null}
        {status.connected ? status.allowModelSharing ? button('githubChoose', 'repositories', true) : button('githubGrant', 'grant', true)
          : button(status.reconnectRequired ? 'githubReconnect' : 'githubConnect', 'connect', true)}
      </div>
    </> : null}
    {menu ? <div className="gmail-data-details-body">
      {status?.repositories.length ? <p>{status.repositories.slice(0, 8).join(' · ')}{status.repositoryCount > 8 ? ' …' : ''}</p> : null}
      {button('githubChoose', 'repositories')}{button('githubSwitch', 'connect')}
      {button('githubStop', 'stop')}{button('githubDisconnect', 'disconnect')}
    </div> : null}
  </section>
}
