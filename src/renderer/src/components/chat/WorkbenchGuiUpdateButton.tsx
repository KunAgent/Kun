import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GuiUpdateState } from '@shared/gui-update'
import { ArrowUpCircle, Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WorkbenchGuiUpdateButton(): ReactElement | null {
  const { t } = useTranslation(['common', 'settings'])
  const [guiUpdateState, setGuiUpdateState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applyingGuiUpdate, setApplyingGuiUpdate] = useState(false)
  const [guiUpdateError, setGuiUpdateError] = useState('')
  const applyingRef = useRef(false)

  useEffect(() => {
    if (typeof window.kunGui?.onGuiUpdateState !== 'function') return
    let receivedEvent = false
    let cancelled = false
    const applyEvent = (state: GuiUpdateState): void => {
      if (cancelled) return
      receivedEvent = true
      setGuiUpdateError(state.status === 'error' ? state.message : '')
      setGuiUpdateState((previous) => {
        // A transient check failure must not discard the known update action.
        const known = previous.info
        if ((state.status === 'checking' || state.status === 'error') &&
          !state.info?.ok && known?.ok && known.hasUpdate &&
          (!state.info?.channel || state.info.channel === known.channel)) {
          return { ...state, info: known }
        }
        return state
      })
    }
    const unsubscribe = window.kunGui.onGuiUpdateState(applyEvent)
    if (typeof window.kunGui?.getGuiUpdateState === 'function') {
      void window.kunGui.getGuiUpdateState().then((state) => {
        if (!cancelled && !receivedEvent) applyEvent(state)
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const guiUpdateAction = useMemo(() => {
    if (guiUpdateState.status === 'idle' || guiUpdateState.status === 'not_available') return null
    return guiUpdateState.info?.ok && guiUpdateState.info.hasUpdate ? guiUpdateState.info : null
  }, [guiUpdateState])
  const guiUpdateBusy =
    applyingGuiUpdate || guiUpdateState.status === 'checking' ||
    guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing'
  const guiUpdateLabel = useMemo(() => {
    if (!guiUpdateAction) return ''
    if (guiUpdateState.status === 'checking') return t('settings:guiUpdateChecking')
    if (guiUpdateState.status === 'downloading') {
      return t('guiUpdateTopbarDownloading', {
        percent: Math.max(0, Math.round(guiUpdateState.progress.percent))
      })
    }
    if (guiUpdateState.status === 'installing') {
      return t('guiUpdateTopbarInstalling')
    }
    if (applyingGuiUpdate && !guiUpdateAction.manualOnly) {
      return guiUpdateAction.downloaded || guiUpdateState.status === 'downloaded'
        ? t('guiUpdateTopbarInstalling')
        : t('guiUpdateTopbarDownloading', { percent: 0 })
    }
    if (guiUpdateAction.downloaded || guiUpdateState.status === 'downloaded') {
      return t('settings:guiUpdateInstall')
    }
    if (guiUpdateAction.manualOnly) {
      return t('guiUpdateTopbarManual', { version: guiUpdateAction.latestVersion })
    }
    return t('guiUpdateTopbarAvailable', { version: guiUpdateAction.latestVersion })
  }, [applyingGuiUpdate, guiUpdateAction, guiUpdateState, t])
  const guiUpdateTitle = useMemo(() => {
    if (!guiUpdateAction) return ''
    return guiUpdateAction.manualOnly
      ? t('settings:guiUpdateAvailableManual', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
      : t('settings:guiUpdateAvailable', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
  }, [guiUpdateAction, t])

  const runGuiUpdateAction = async (): Promise<void> => {
    if (!guiUpdateAction || guiUpdateBusy || applyingRef.current) return
    if (!guiUpdateAction.manualOnly && (
      typeof window.kunGui?.downloadGuiUpdate !== 'function' ||
      typeof window.kunGui?.installGuiUpdate !== 'function'
    )) {
      return
    }

    applyingRef.current = true
    setApplyingGuiUpdate(true)
    setGuiUpdateError('')
    try {
      if (guiUpdateAction.manualOnly) {
        await window.kunGui.openExternal?.(guiUpdateAction.releaseUrl)
        return
      }
      if (!guiUpdateAction.downloaded && guiUpdateState.status !== 'downloaded') {
        const downloadResult = await window.kunGui.downloadGuiUpdate(guiUpdateAction.channel)
        if (!downloadResult.ok) throw new Error(downloadResult.message)
      }
      const installResult = await window.kunGui.installGuiUpdate()
      if (!installResult.ok) throw new Error(installResult.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setGuiUpdateError(message)
      setGuiUpdateState((current) => {
        if (current.status === 'idle' || current.status === 'not_available' ||
          current.info?.channel !== guiUpdateAction.channel) return current
        return { status: 'error', info: current.info, message }
      })
      if (typeof window.kunGui?.logError === 'function') {
        await window.kunGui.logError('gui-update', 'Failed to apply GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message
        }).catch(() => undefined)
      }
    } finally {
      applyingRef.current = false
      setApplyingGuiUpdate(false)
    }
  }

  const renderGuiUpdateIcon = (): ReactElement => {
    if (guiUpdateBusy) {
      return <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
    }
    if (guiUpdateAction?.downloaded || guiUpdateState.status === 'downloaded') {
      return <RefreshCw className="h-4 w-4" strokeWidth={1.85} />
    }
    if (guiUpdateAction?.manualOnly) {
      return <ExternalLink className="h-4 w-4" strokeWidth={1.85} />
    }
    if (guiUpdateAction) {
      return <ArrowUpCircle className="h-4 w-4" strokeWidth={1.85} />
    }
    return <Download className="h-4 w-4" strokeWidth={1.85} />
  }

  if (!guiUpdateAction) return null

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => void runGuiUpdateAction()}
        disabled={guiUpdateBusy}
        className={`${guiUpdateError && !guiUpdateBusy ? '' : 'ds-topbar-action-button '}relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-amber-300/75 bg-amber-50/92 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/70 dark:bg-amber-950/35 dark:text-amber-100 dark:hover:bg-amber-900/45`}
        data-tooltip={guiUpdateBusy ? guiUpdateLabel : guiUpdateError || guiUpdateTitle}
        aria-label={guiUpdateBusy ? guiUpdateLabel : guiUpdateError || guiUpdateTitle}
      >
        {renderGuiUpdateIcon()}
        {!guiUpdateBusy ? (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_0_2px_rgba(245,158,11,0.18)]" />
        ) : null}
      </button>
      {guiUpdateError && !guiUpdateBusy ? (
        <span role="alert" className="absolute right-0 top-10 z-50 flex w-72 max-w-[calc(100vw-2rem)] items-start gap-2 break-words rounded-lg border border-ds-border bg-ds-card p-3 text-xs text-ds-danger shadow-lg">
          <span className="min-w-0 flex-1">{guiUpdateError}</span>
          <button type="button" onClick={() => setGuiUpdateError('')} aria-label={t('close')}
            className="shrink-0 rounded text-ds-muted hover:text-ds-ink">
            <X className="h-4 w-4" />
          </button>
        </span>
      ) : null}
    </span>
  )
}
