import type {
  StorageCleanupHistoryEntry,
  StorageCleanupPlan,
  StorageCleanupResult,
  StorageCleanupStatus,
  StorageTrashRestoreResponse,
  StorageUsageSnapshot
} from '@shared/storage-cleanup'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './settings-storage-cleanup-support'

export type StorageCleanupDialog =
  | { kind: 'consent'; days: number; plan: StorageCleanupPlan | null }
  | { kind: 'review'; days: number; plan: StorageCleanupPlan | null }
  | null

/** Settings → Storage state: status, scan, history and the action runner. */
export function useStorageCleanup() {
  const api = window.kunGui.storageCleanup
  const [status, setStatus] = useState<StorageCleanupStatus | null>(null)
  const [usage, setUsage] = useState<StorageUsageSnapshot | null>(null)
  const [scanning, setScanning] = useState(false)
  const [history, setHistory] = useState<StorageCleanupHistoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<StorageCleanupResult | null>(null)
  const [dialog, setDialog] = useState<StorageCleanupDialog>(null)
  // A dialog closed while its preview is loading must not reopen when it lands.
  const dialogToken = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextHistory] = await Promise.all([api.getStatus(), api.history()])
      setStatus(nextStatus)
      setHistory(nextHistory)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setUsage(await api.scan())
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setScanning(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
    void scan()
  }, [refresh, scan])

  const act = useCallback(async <T,>(work: () => Promise<T>, after?: (value: T) => void): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const value = await work()
      after?.(value)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const finishRun = useCallback((value: StorageCleanupResult) => {
    setResult(value)
    setDialog(null)
    void refresh()
    void scan()
  }, [refresh, scan])

  const finishRestore = useCallback((value: StorageTrashRestoreResponse) => {
    setStatus((current) => current ? { ...current, trash: value.trash } : current)
    setError(value.failures.map((failure) => `${failure.path}: [${failure.code}] ${failure.message}`).join('\n'))
    void refresh()
    void scan()
  }, [refresh, scan])

  const openDialog = useCallback((kind: 'consent' | 'review', days: number) => {
    const token = ++dialogToken.current
    setDialog({ kind, days, plan: null })
    api.preview({ olderThanDays: days }).then((plan) => {
      if (dialogToken.current === token) setDialog((current) => (current ? { ...current, plan } : current))
    }, (cause) => {
      if (dialogToken.current !== token) return
      setDialog(null)
      setError(errorText(cause))
    })
  }, [api])

  const closeDialog = useCallback(() => {
    dialogToken.current += 1
    setDialog(null)
  }, [])

  return {
    api,
    status,
    usage,
    scanning,
    history,
    busy,
    error,
    result,
    dialog,
    setDialog,
    setStatus,
    refresh,
    scan,
    act,
    finishRun,
    finishRestore,
    openDialog,
    closeDialog,
    dismissResult: () => setResult(null)
  }
}
