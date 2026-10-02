import { settingsButtonClass } from './settings-button'
import type {
  AntigravitySubscriptionModelCatalog
} from '@shared/kun-gui-api'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement
} from 'react'
import {
  InlineNoticeView,
  type InlineNotice
} from './settings-controls'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'


export type GeminiCliState = 'checking' | 'missing' | 'downloading' | 'ready' | 'syncing'

export function GeminiSubscriptionSection({
  onModelsChange,
  t
}: {
  onModelsChange: (catalog: AntigravitySubscriptionModelCatalog) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [state, setState] = useState<GeminiCliState>('checking')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [notice, setNotice] = useState<InlineNotice | null>(null)

  const applyDownload = useCallback((
    download: { status: string; receivedBytes: number; totalBytes: number; message?: string } | null | undefined
  ): boolean => {
    if (!download) return false
    if (download.status === 'downloading') {
      setState('downloading')
      setProgress({ received: download.receivedBytes, total: download.totalBytes })
      return true
    }
    if (download.status === 'done') {
      setState('ready')
      setProgress(null)
      return true
    }
    if (download.status === 'error') {
      setState('missing')
      setProgress(null)
      setNotice({ tone: 'error', message: download.message ?? t('geminiCliInstallFailed') })
      return true
    }
    return false
  }, [t])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.kunGui.geminiSubscriptionCliStatus()
      if (status.installed) {
        setState('ready')
        setProgress(null)
      } else if (!applyDownload(status.download)) {
        setState('missing')
      }
    } catch (error) {
      setState('missing')
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliInstallFailed')
      })
    }
  }, [applyDownload, t])

  useEffect(() => {
    void refreshStatus()
    return window.kunGui.onGeminiSubscriptionCliProgress((download) => {
      applyDownload(download)
      if (download.status === 'done') void refreshStatus()
    })
  }, [applyDownload, refreshStatus])

  const install = async (): Promise<void> => {
    setNotice(null)
    setState('downloading')
    setProgress({ received: 0, total: 0 })
    try {
      applyDownload(await window.kunGui.geminiSubscriptionCliInstall())
    } catch (error) {
      setState('missing')
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliInstallFailed')
      })
    }
  }

  const syncModels = async (): Promise<void> => {
    setState('syncing')
    setNotice(null)
    try {
      const catalog = await window.kunGui.geminiSubscriptionModels()
      onModelsChange(catalog)
      setNotice({
        tone: 'success',
        message: t('geminiModelsSynced', { count: catalog.models.length })
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiModelsSyncFailed')
      })
    } finally {
      setState('ready')
    }
  }

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0
  const busy = state === 'checking' || state === 'downloading' || state === 'syncing'

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-5 text-ds-muted">
        <p>{t('geminiSubscriptionNote')}</p>
        <p className="text-ds-ink/85">{t('geminiSubscriptionLimitations')}</p>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-ds-ink">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-ds-muted" strokeWidth={1.9} />
        ) : state === 'ready' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.9} />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" strokeWidth={1.9} />
        )}
        <span>{state === 'ready' || state === 'syncing'
          ? t('geminiCliReady')
          : state === 'downloading'
            ? t('geminiCliDownloading')
            : state === 'checking'
              ? t('geminiCliChecking')
              : t('geminiCliMissing')}</span>
      </div>
      {state === 'downloading' ? (
        <div className="grid gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-ds-hover">
            <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-[11px] text-ds-faint">
            {progress?.total ? `${percent}%` : t('geminiCliDownloading')}
          </span>
        </div>
      ) : null}
      {state === 'missing' ? (
        <button
          type="button"
           className={settingsButtonClass({ variant: 'primary', className: 'w-full' })}
          onClick={() => void install()}
        >
          <Download className="h-4 w-4" strokeWidth={1.9} />
          {t('geminiCliInstall')}
        </button>
      ) : (
        <button aria-busy={Boolean(state === 'syncing')}
          type="button"
          className={settingsButtonClass({ className: 'w-full' })}
          onClick={() => void syncModels()}
          disabled={busy}
        >
          {state === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('geminiSyncModels')}
        </button>
      )}
      {notice ? <InlineNoticeView notice={notice} /> : null}
    </div>
  )
}

export function GeminiCliApiSubscriptionSection({
  onModelsChange,
  t
}: {
  onModelsChange: (models: string[]) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [checking, setChecking] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{
    installed: boolean
    authenticated: boolean
    path?: string
    credentialSource?: 'keychain' | 'file'
  } | null>(null)
  const [notice, setNotice] = useState<InlineNotice | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      setStatus(await window.kunGui.geminiCliSubscriptionStatus())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliApiStatusFailed')
      })
    } finally {
      setChecking(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const syncModels = async (): Promise<void> => {
    setSyncing(true)
    setNotice(null)
    try {
      const models = await window.kunGui.geminiCliSubscriptionModels()
      onModelsChange(models)
      setNotice({
        tone: 'success',
        message: t('geminiCliApiModelsSynced', { count: models.length })
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : t('geminiCliApiModelsSyncFailed')
      })
    } finally {
      setSyncing(false)
    }
  }

  const ready = status?.authenticated === true
  return (
    <div className="grid gap-3">
      <p className="rounded-lg border border-ds-border bg-ds-main/30 px-3 py-2 text-[12px] leading-5 text-ds-muted">
        {t('geminiCliApiSubscriptionNote')}
      </p>
      <div className="flex items-center gap-2 text-[13px] text-ds-ink">
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin text-ds-muted" strokeWidth={1.9} />
        ) : ready ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.9} />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" strokeWidth={1.9} />
        )}
        <span>
          {checking
            ? t('geminiCliApiChecking')
            : ready
              ? t('geminiCliApiReady')
              : status?.installed
                ? t('geminiCliApiLoginRequired')
                : t('geminiCliApiMissing')}
        </span>
      </div>
      {!checking && !ready ? (
        <p className="text-[12px] leading-5 text-ds-muted">
          {status?.installed
            ? t('geminiCliApiLoginHint')
            : t('geminiCliApiInstallHint')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button aria-busy={Boolean(checking)}
          type="button"
          className={settingsButtonClass({ className: 'w-full' })}
          onClick={() => void refresh()}
          disabled={checking}
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {t('geminiCliApiRecheck')}
        </button>
        <button aria-busy={Boolean(syncing)}
          type="button"
          className={settingsButtonClass({ className: 'w-full' })}
          onClick={() => void syncModels()}
          disabled={syncing}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('geminiCliApiSyncModels')}
        </button>
      </div>
      {notice ? <InlineNoticeView notice={notice} /> : null}
    </div>
  )
}
