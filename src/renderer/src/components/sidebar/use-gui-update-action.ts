import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GuiUpdateInfo, GuiUpdateProgress, GuiUpdateState } from '@shared/gui-update'

export type GuiUpdateReleaseInfo = Extract<GuiUpdateInfo, { ok: true }>

/** What the footer update entry shows; one visual state per phase. */
export type GuiUpdatePhase = 'available' | 'downloading' | 'downloaded' | 'installing' | 'manual' | 'error'

export type GuiUpdateAction = {
  info: GuiUpdateReleaseInfo
  phase: GuiUpdatePhase
  /** Checking, downloading or installing: the apply action is unavailable. */
  busy: boolean
  percent: number
  progress: GuiUpdateProgress | null
  error: string
  apply: () => Promise<void>
  openReleasePage: () => void
  dismissError: () => void
}

/**
 * Follows the GUI update state from main and applies a known update
 * (download, then install; manual-only releases open their page).
 * Returns null while there is no update to offer.
 */
export function useGuiUpdateAction(): GuiUpdateAction | null {
  const [state, setState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const applyingRef = useRef(false)

  useEffect(() => {
    if (typeof window.kunGui?.onGuiUpdateState !== 'function') return
    let receivedEvent = false
    let cancelled = false
    const applyEvent = (next: GuiUpdateState): void => {
      if (cancelled) return
      receivedEvent = true
      setError(next.status === 'error' ? next.message : '')
      setState((previous) => {
        // A transient check failure must not discard the known update action.
        const known = previous.info
        if ((next.status === 'checking' || next.status === 'error') &&
          !next.info?.ok && known?.ok && known.hasUpdate &&
          (!next.info?.channel || next.info.channel === known.channel)) {
          return { ...next, info: known }
        }
        return next
      })
    }
    const unsubscribe = window.kunGui.onGuiUpdateState(applyEvent)
    if (typeof window.kunGui?.getGuiUpdateState === 'function') {
      void window.kunGui.getGuiUpdateState().then((initial) => {
        if (!cancelled && !receivedEvent) applyEvent(initial)
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const info = useMemo(() => {
    if (state.status === 'idle' || state.status === 'not_available') return null
    return state.info?.ok && state.info.hasUpdate ? state.info : null
  }, [state])

  const apply = useCallback(async (): Promise<void> => {
    if (!info || applyingRef.current) return
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'installing') return
    if (!info.manualOnly && (
      typeof window.kunGui?.downloadGuiUpdate !== 'function' ||
      typeof window.kunGui?.installGuiUpdate !== 'function'
    )) {
      return
    }

    applyingRef.current = true
    setApplying(true)
    setError('')
    try {
      if (info.manualOnly) {
        await window.kunGui.openExternal?.(info.releaseUrl)
        return
      }
      if (!info.downloaded && state.status !== 'downloaded') {
        const downloadResult = await window.kunGui.downloadGuiUpdate(info.channel)
        if (!downloadResult.ok) throw new Error(downloadResult.message)
      }
      const installResult = await window.kunGui.installGuiUpdate()
      if (!installResult.ok) throw new Error(installResult.message)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      setState((current) => {
        if (current.status === 'idle' || current.status === 'not_available' ||
          current.info?.channel !== info.channel) return current
        return { status: 'error', info: current.info, message }
      })
      if (typeof window.kunGui?.logError === 'function') {
        await window.kunGui.logError('gui-update', 'Failed to apply GUI update from the sidebar footer', {
          version: info.latestVersion,
          message
        }).catch(() => undefined)
      }
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }, [info, state.status])

  const openReleasePage = useCallback((): void => {
    if (info?.releaseUrl) void window.kunGui?.openExternal?.(info.releaseUrl)
  }, [info])
  const dismissError = useCallback((): void => setError(''), [])

  if (!info) return null
  const downloaded = Boolean(info.downloaded) || state.status === 'downloaded'
  const installing = state.status === 'installing' || (applying && !info.manualOnly && downloaded)
  const downloading = state.status === 'downloading' || (applying && !info.manualOnly && !downloaded)
  const busy = applying || installing || downloading || state.status === 'checking'
  const progress = state.status === 'downloading' ? state.progress : null
  const phase: GuiUpdatePhase = installing
    ? 'installing'
    : downloading
      ? 'downloading'
      : error && !busy
        ? 'error'
        : info.manualOnly
          ? 'manual'
          : downloaded
            ? 'downloaded'
            : 'available'
  return {
    info,
    phase,
    busy,
    percent: Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0))),
    progress,
    error,
    apply,
    openReleasePage,
    dismissError
  }
}
