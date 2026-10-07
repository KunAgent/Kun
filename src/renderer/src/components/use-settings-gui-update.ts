import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import type {
  GuiUpdateChannel,
  GuiUpdateInfo,
  GuiUpdateProgress,
  GuiUpdateState
} from '@shared/gui-update'
import { guiUpdateFailureMessage } from './settings-utils'

export function useSettingsGuiUpdate({
  category,
  channel,
  form,
  t
}: {
  category: 'general' | 'providers' | 'write' | 'design' | 'imageGeneration' | 'mediaGeneration' | 'speechToText' | 'agents' | 'laboratory' | 'subagents' | 'archives' | 'permissions' | 'worktree' | 'memory' | 'shortcuts' | 'easterEgg' | 'claw' | 'updates' | 'debug' | 'terminal' | 'storage' | 'dataMigration' | 'uninstall'
  channel: GuiUpdateChannel | undefined
  form: AppSettingsV1 | null
  t: (key: string, values?: Record<string, unknown>) => string
}) {
  const [guiUpdateInfo, setGuiUpdateInfo] = useState<GuiUpdateInfo | null>(null)
  const [checkingGuiUpdate, setCheckingGuiUpdate] = useState(false)
  const [downloadingGuiUpdate, setDownloadingGuiUpdate] = useState(false)
  const [installingGuiUpdate, setInstallingGuiUpdate] = useState(false)
  const [guiUpdateDownloaded, setGuiUpdateDownloaded] = useState(false)
  const [guiUpdateProgress, setGuiUpdateProgress] = useState<GuiUpdateProgress | null>(null)
  const [guiUpdateError, setGuiUpdateError] = useState<string | null>(null)
  const checkedGuiUpdateChannel = useRef<GuiUpdateChannel | null>(null)
  const operationGeneration = useRef(0)

  const resetGuiUpdateState = useCallback((): void => {
    operationGeneration.current += 1
    setCheckingGuiUpdate(false)
    setDownloadingGuiUpdate(false)
    setInstallingGuiUpdate(false)
    setGuiUpdateInfo(null)
    setGuiUpdateError(null)
    setGuiUpdateDownloaded(false)
    setGuiUpdateProgress(null)
  }, [])

  const applyGuiUpdateState = useCallback((state: GuiUpdateState): void => {
    if ('info' in state && state.info?.ok && channel && state.info.channel !== channel) return
    if (state.status === 'idle') {
      resetGuiUpdateState()
      return
    }
    if ('info' in state && state.info) {
      setGuiUpdateInfo(state.info)
    }
    if (state.status === 'checking') {
      setCheckingGuiUpdate(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'available' || state.status === 'not_available') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(Boolean(state.info.downloaded))
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloading') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(true)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(state.progress)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloaded') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'installing') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(true)
      setGuiUpdateProgress(null)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'error') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateError(state.message)
    }
  }, [channel, resetGuiUpdateState])

  const checkGuiUpdate = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.checkGuiUpdate !== 'function') return
    const operation = ++operationGeneration.current
    setCheckingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const info = await window.kunGui.checkGuiUpdate(channel)
      if (operation !== operationGeneration.current) return
      setGuiUpdateInfo(info)
      if (!info.ok) {
        setGuiUpdateError(info.code === 'not_configured' ? null : guiUpdateFailureMessage(info, t))
      }
    } catch (e) {
      if (operation !== operationGeneration.current) return
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      if (operation === operationGeneration.current) setCheckingGuiUpdate(false)
    }
  }, [channel, t])

  const downloadGuiUpdate = async (): Promise<void> => {
    if (typeof window.kunGui?.downloadGuiUpdate !== 'function') return
    const operation = ++operationGeneration.current
    const selectedChannel = form?.guiUpdate?.channel
    setDownloadingGuiUpdate(true)
    setGuiUpdateProgress(null)
    setGuiUpdateError(null)
    try {
      const result = await window.kunGui.downloadGuiUpdate(selectedChannel)
      if (operation !== operationGeneration.current) return
      if (!result.ok) {
        setGuiUpdateError(result.message)
        return
      }
      setGuiUpdateDownloaded(true)
    } catch (e) {
      if (operation !== operationGeneration.current) return
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      if (operation === operationGeneration.current) setDownloadingGuiUpdate(false)
    }
  }

  const installGuiUpdate = async (): Promise<void> => {
    if (typeof window.kunGui?.installGuiUpdate !== 'function') return
    setInstallingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const result = await window.kunGui.installGuiUpdate()
      if (!result.ok) {
        setGuiUpdateError(result.message)
        setInstallingGuiUpdate(false)
      }
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
      setInstallingGuiUpdate(false)
    }
  }

  useEffect(() => {
    if (typeof window.kunGui?.onGuiUpdateState !== 'function') return
    let receivedEvent = false
    let cancelled = false
    const applyEvent = (state: GuiUpdateState): void => {
      receivedEvent = true
      applyGuiUpdateState(state)
    }
    const unsubscribe = window.kunGui.onGuiUpdateState(applyEvent)
    if (typeof window.kunGui?.getGuiUpdateState === 'function') {
      void window.kunGui.getGuiUpdateState().then((state) => {
        if (!cancelled && !receivedEvent) applyGuiUpdateState(state)
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyGuiUpdateState])

  useEffect(() => {
    if (!form || category !== 'updates') return
    if (checkedGuiUpdateChannel.current === (channel ?? null)) return
    checkedGuiUpdateChannel.current = channel ?? null
    void checkGuiUpdate()
  }, [category, checkGuiUpdate, channel, form])

  return {
    checkingGuiUpdate,
    checkGuiUpdate,
    downloadingGuiUpdate,
    downloadGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateError,
    guiUpdateInfo,
    guiUpdateProgress,
    installingGuiUpdate,
    installGuiUpdate,
    resetGuiUpdateState
  }
}
