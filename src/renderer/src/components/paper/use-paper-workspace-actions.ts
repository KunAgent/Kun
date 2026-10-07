import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { addPaperLibrary, switchPaperLibrary, type PaperModeToggleResult } from '../../paper/paper-mode-actions'

/** UI-level guard also covers native pickers, before the settings action starts. */
export function usePaperWorkspaceActions() {
  const { t } = useTranslation('common')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<PaperModeToggleResult>): Promise<boolean> => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result.ok) return true
      if (result.message !== 'switch-canceled') {
        setError(result.message === 'save-failed' ? t('writePaperModeSaveFailed') : result.message)
      }
      return false
    } catch (failure) {
      setError(formatWorkspacePickerError(failure))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const switchWorkspace = (root: string): Promise<boolean> => run(() => switchPaperLibrary(root))
  const chooseWorkspace = (): Promise<boolean> => run(async () => {
    if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
      throw new Error('workspace:pick-directory unavailable')
    }
    const picked = await window.kunGui.pickWorkspaceDirectory(
      useWriteWorkspaceStore.getState().workspaceRoot || undefined
    )
    if (picked.canceled || !picked.path) return { ok: false, message: 'switch-canceled' }
    return addPaperLibrary(normalizePath(picked.path))
  })

  return { busy, error, run, switchWorkspace, chooseWorkspace }
}
