import type {
  ModelProviderProfileV1
} from '@shared/app-settings'
import type { GrokBrowserAuthResult } from '@shared/kun-gui-api'
import {
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
  InlineNoticeView
} from './settings-controls'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'

import { parseGrokIdentity } from './settings-section-providers-profile'

export type GrokLoginPhase = 'idle' | 'browser' | 'error'

type GrokBrowserAuthFailure = Extract<GrokBrowserAuthResult, { ok: false }>

export function formatGrokBrowserAuthFailure(
  result: GrokBrowserAuthFailure,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const key = result.code === 'discovery_failed'
    ? 'grokAuthErrorDiscovery'
    : result.code === 'browser_open_failed'
      ? 'grokAuthErrorBrowserOpen'
      : result.code === 'token_exchange_failed'
        ? 'grokAuthErrorTokenExchange'
        : result.code === 'timeout'
          ? 'grokAuthErrorTimeout'
          : result.code === 'cancelled'
            ? 'grokAuthErrorCancelled'
            : result.code === 'port_in_use' || result.code === 'callback_failed'
              ? 'grokAuthErrorCallback'
              : ''
  if (!key) return result.message
  const guidance = t(key)
  const detail = result.message.trim()
  return detail && detail !== guidance && result.code !== 'cancelled'
    ? `${guidance} ${detail}`
    : guidance
}

export function GrokLoginSection({
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
  const [phase, setPhase] = useState<GrokLoginPhase>('idle')
  const [error, setError] = useState('')
  const [pasteCode, setPasteCode] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const loginRunRef = useRef(0)
  const identity = parseGrokIdentity(provider.apiKey)
  const connected = Boolean(identity || configured)

  const beginLoginRun = (): number => {
    loginRunRef.current += 1
    return loginRunRef.current
  }

  const isCurrentLoginRun = (runId: number): boolean => loginRunRef.current === runId

  useEffect(() => {
    return () => {
      loginRunRef.current += 1
      void window.kunGui?.cancelGrokBrowserAuth?.()
    }
  }, [])

  const startBrowserLogin = async (): Promise<void> => {
    const runId = beginLoginRun()
    if (typeof window.kunGui?.startGrokBrowserAuth !== 'function') {
      setPhase('error')
      setError('Grok 订阅浏览器登录不可用，请重启应用')
      return
    }
    setPhase('browser')
    setError('')
    setPasteCode('')
    setPasteBusy(false)
    try {
      // Blocks until loopback callback OR paste completion (Path A + B race).
      const result = await window.kunGui.startGrokBrowserAuth({
        providerId: provider.id,
        useProxy: provider.useProxy
      })
      if (!isCurrentLoginRun(runId)) return
      if (result.ok) {
        setPasteCode('')
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else if (result.code === 'cancelled') {
        setPhase('idle')
        setError('')
      } else {
        setPhase('error')
        setError(formatGrokBrowserAuthFailure(result, t))
      }
    } catch (err) {
      if (!isCurrentLoginRun(runId)) return
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPasteBusy(false)
    }
  }

  const submitPastedCode = async (): Promise<void> => {
    const code = pasteCode.trim()
    if (!code || pasteBusy) return
    if (typeof window.kunGui?.submitGrokBrowserAuthCode !== 'function') {
      setError('Grok 粘贴登录不可用，请重启应用')
      return
    }
    setPasteBusy(true)
    setError('')
    try {
      const result = await window.kunGui.submitGrokBrowserAuthCode(code)
      // On success, startGrokBrowserAuth's promise also resolves and the browser
      // phase handler will store credentials. On failure keep the paste form open.
      if (!result.ok) {
        setError(formatGrokBrowserAuthFailure(result, t))
        setPasteBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPasteBusy(false)
    }
  }

  const cancelLogin = (): void => {
    loginRunRef.current += 1
    void window.kunGui?.cancelGrokBrowserAuth?.()
    setPhase('idle')
    setError('')
    setPasteCode('')
    setPasteBusy(false)
  }

  const disconnect = (): void => {
    loginRunRef.current += 1
    void window.kunGui?.cancelGrokBrowserAuth?.()
    onCredentialChange('')
    setPhase('idle')
    setPasteCode('')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{identity ?? provider.name}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('grokDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('grokBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('grokWaitingAuth')}
        </div>
        <div className="grid gap-1.5 rounded-xl border border-ds-border bg-ds-card p-3">
          <p className="text-[12px] leading-5 text-ds-muted">{t('grokPasteCodeHint')}</p>
          <textarea
            className="min-h-[72px] w-full resize-y rounded-lg border border-ds-border bg-ds-main px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
            value={pasteCode}
            spellCheck={false}
            placeholder={t('grokPasteCodePlaceholder')}
            onChange={(e) => setPasteCode(e.target.value)}
            disabled={pasteBusy}
          />
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void submitPastedCode()}
            disabled={pasteBusy || !pasteCode.trim()}
          >
            {pasteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('grokPasteCodeSubmit')}
          </button>
        </div>
        {error ? <InlineNoticeView notice={{ tone: 'error', message: error }} /> : null}
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('grokCancel')}
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
        {t('grokLoginButton')}
      </button>
      {phase === 'error' && error ? (
        <InlineNoticeView notice={{ tone: 'error', message: error }} />
      ) : null}
    </div>
  )
}
