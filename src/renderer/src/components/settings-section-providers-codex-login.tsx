import type {
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import {
  InlineNoticeView,
  type InlineNotice
} from './settings-controls'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'

import { parseCodexEmail } from './settings-section-providers-profile'

export type CodexLoginPhase = 'idle' | 'browser' | 'device-starting' | 'polling' | 'error'

export function CodexLoginSection({
  provider,
  configured = false,
  onCredentialChange,
  t
}: {
  provider: ModelProviderProfileV1
  configured?: boolean
  onCredentialChange: (apiKey: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [phase, setPhase] = useState<CodexLoginPhase>('idle')
  const [userCode, setUserCode] = useState('')
  const [verifyUrl, setVerifyUrl] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loginRunRef = useRef(0)
  const codexEmail = parseCodexEmail(provider.apiKey)
  const connected = Boolean(codexEmail || configured)

  const clearPoll = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const beginLoginRun = (): number => {
    clearPoll()
    loginRunRef.current += 1
    return loginRunRef.current
  }

  const isCurrentLoginRun = (runId: number): boolean => loginRunRef.current === runId

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      loginRunRef.current += 1
    }
  }, [])

  const startDeviceCodeLogin = async ({
    runId = beginLoginRun(),
    fallbackNotice = null
  }: {
    runId?: number
    fallbackNotice?: InlineNotice | null
  } = {}): Promise<void> => {
    if (typeof window.kunGui?.startCodexAuth !== 'function') {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError('ChatGPT 订阅登录不可用，请重启应用')
      setNotice(null)
      return
    }
    setPhase('device-starting')
    setError('')
    setNotice(fallbackNotice)
    try {
      const selection = { providerId: provider.id, useProxy: provider.useProxy }
      const result = await window.kunGui.startCodexAuth(selection)
      if (!isCurrentLoginRun(runId)) return
      if (!result.ok) {
        setPhase('error')
        setError(result.message)
        setNotice(null)
        return
      }
      setUserCode(result.userCode)
      setVerifyUrl(result.url)
      setPhase('polling')
      const deviceCode = result.deviceCode
      const uc = result.userCode
      const interval = Math.max(result.interval, 2) * 1000
      clearPoll()
      pollRef.current = setInterval(async () => {
        if (!isCurrentLoginRun(runId)) {
          clearPoll()
          return
        }
        if (typeof window.kunGui?.pollCodexAuth !== 'function') return
        try {
          const poll = await window.kunGui.pollCodexAuth(deviceCode, uc, selection)
          if (!isCurrentLoginRun(runId)) return
          if (poll.done) {
            clearPoll()
            setNotice(null)
            onCredentialChange(JSON.stringify(poll.credentials))
            setPhase('idle')
          } else if (poll.error) {
            clearPoll()
            setPhase('error')
            setError(poll.error)
            setNotice(null)
          }
        } catch (pollError) {
          if (!isCurrentLoginRun(runId)) return
          clearPoll()
          setPhase('error')
          setError(pollError instanceof Error ? pollError.message : String(pollError))
          setNotice(null)
        }
      }, interval)
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
      setNotice(null)
    }
  }

  const startBrowserLogin = async (): Promise<void> => {
    const runId = beginLoginRun()
    if (typeof window.kunGui?.startCodexBrowserAuth !== 'function') {
      setPhase('error')
      setError('ChatGPT 订阅浏览器登录不可用，请重启应用')
      setNotice(null)
      return
    }
    setPhase('browser')
    setError('')
    setNotice(null)
    try {
      const result = await window.kunGui.startCodexBrowserAuth({
        providerId: provider.id,
        useProxy: provider.useProxy
      })
      if (!isCurrentLoginRun(runId)) return
      if (result.ok) {
        setNotice(null)
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else if (result.code === 'port_in_use') {
        await startDeviceCodeLogin({
          runId,
          fallbackNotice: {
            tone: 'info',
            message: t('codexLoginPortBusyFallback')
          }
        })
      } else {
        setPhase('error')
        setError(result.message)
      }
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
      setNotice(null)
    }
  }

  const cancelLogin = (): void => {
    loginRunRef.current += 1
    clearPoll()
    setPhase('idle')
    setError('')
    setNotice(null)
  }

  const disconnect = (): void => {
    loginRunRef.current += 1
    clearPoll()
    onCredentialChange('')
    setPhase('idle')
    setUserCode('')
    setVerifyUrl('')
    setNotice(null)
  }

  const openVerifyUrl = (): void => {
    if (!verifyUrl) return
    if (typeof window.kunGui?.openExternal === 'function') {
      void window.kunGui.openExternal(verifyUrl).catch(() => {
        window.open(verifyUrl, '_blank', 'noopener,noreferrer')
      })
      return
    }
    window.open(verifyUrl, '_blank', 'noopener,noreferrer')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{codexEmail ?? provider.name}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('codexDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('codexBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  if (phase === 'device-starting') {
    return (
      <div className="grid gap-2">
        {notice ? <InlineNoticeView notice={notice} /> : null}
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexPreparingDeviceLogin')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  if (phase === 'polling') {
    return (
      <div className="grid gap-2">
        {notice ? <InlineNoticeView notice={notice} /> : null}
        <p className="text-[13px] text-ds-muted">{t('codexEnterCode')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-ds-hover px-3 py-1.5 text-[16px] font-mono font-bold tracking-widest text-ds-ink">
            {userCode}
          </code>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openVerifyUrl}
            disabled={!verifyUrl}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('codexOpenBrowser')}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
        onClick={startBrowserLogin}
      >
        <LogIn className="h-4 w-4" strokeWidth={1.9} />
        {t('codexLoginButton')}
      </button>
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover"
        onClick={() => void startDeviceCodeLogin()}
      >
        <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('codexLoginDeviceCodeFallback')}
      </button>
      {phase === 'error' && error ? (
        <InlineNoticeView notice={{ tone: 'error', message: error }} />
      ) : null}
    </div>
  )
}
