import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FolderOpen, FolderPlus, GraduationCap, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { addPaperLibrary } from '../../paper/paper-mode-actions'
import { usePaperWorkspaceBootstrapStore } from '../../paper/paper-workspace-bootstrap'
import type { PaperLibraryCandidate } from '@shared/paper/paper-library-types'

/**
 * Readiness and recovery for the automatic local workspace. Folder selection
 * remains an escape hatch, with existing paper-containing workspaces offered
 * explicitly rather than silently adopting document folders.
 */
export function PaperLibraryOnboarding(): ReactElement {
  const { t } = useTranslation('common')
  const { workspaceRoots, paperReading, setFileError } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoots: s.workspaceRoots,
      paperReading: s.paperReading,
      setFileError: s.setFileError
    }))
  )
  const [candidates, setCandidates] = useState<PaperLibraryCandidate[] | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const status = usePaperWorkspaceBootstrapStore((s) => s.status)
  const bootstrapError = usePaperWorkspaceBootstrapStore((s) => s.error)
  const error = actionError || bootstrapError
  const settingsLoading = useWriteWorkspaceStore((s) => s.settingsLoading)
  const preparing = status === 'loading' || (status === 'idle' && settingsLoading)
  const busy = pending || preparing

  useEffect(() => {
    if (status === 'idle' && !settingsLoading) {
      void useWriteWorkspaceStore.getState().loadWriteSettings()
    }
  }, [status, settingsLoading])

  useEffect(() => {
    if (typeof window.kunGui?.paperDetectLibraries !== 'function' || workspaceRoots.length === 0) {
      setCandidates([])
      return
    }
    let canceled = false
    window.kunGui
      .paperDetectLibraries({ workspaceRoots, papersDir: paperReading.papersDir })
      .then((result) => {
        if (!canceled) setCandidates(result.ok ? result.candidates : [])
      })
      .catch(() => {
        if (!canceled) setCandidates([])
      })
    return () => {
      canceled = true
    }
  }, [workspaceRoots, paperReading.papersDir])

  const pick = async (): Promise<void> => {
    if (busy || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    try {
      const picked = await window.kunGui.pickWorkspaceDirectory(undefined)
      if (!picked.canceled && picked.path) {
        const result = await addPaperLibrary(picked.path)
        if (!result.ok && result.message !== 'switch-canceled') {
          setActionError(result.message)
          setFileError(result.message)
        }
      }
    } catch (error) {
      const message = formatWorkspacePickerError(error)
      setActionError(message)
      setFileError(message)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const adopt = async (path: string): Promise<void> => {
    if (busy || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    try {
      const result = await addPaperLibrary(path)
      if (!result.ok && result.message !== 'switch-canceled') setActionError(result.message)
    } catch (error) {
      setActionError(formatWorkspacePickerError(error))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <div data-testid="paper-workspace-recovery" className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
      <div className="my-auto w-full max-w-lg rounded-[24px] border border-ds-border bg-ds-elevated px-5 py-7 sm:px-8 sm:py-8 text-center shadow-[0_22px_56px_rgba(20,47,95,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-tint/10 text-accent">
          <GraduationCap className="h-6 w-6" strokeWidth={1.9} />
        </div>
        <h2 className="mt-5 text-[24px] font-semibold tracking-[-0.04em] text-ds-ink">
          {t(preparing ? 'paperWorkspacePreparing' : 'paperWorkspaceUnavailable')}
        </h2>
        <p className="mt-3 text-[14.5px] leading-7 text-ds-muted">
          {t(preparing ? 'paperWorkspacePreparingHint' : 'paperWorkspaceUnavailableHint')}
        </p>
        {preparing ? (
          <div role="status" className="mt-6 flex items-center justify-center gap-2 text-[13px] text-ds-muted">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            {t('paperWorkspacePreparing')}
          </div>
        ) : (
          <button type="button" disabled={pending}
            onClick={() => {
              setActionError(null)
              void useWriteWorkspaceStore.getState().loadWriteSettings()
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60">
            {t('paperWorkspaceRetry')}
          </button>
        )}
        {error ? (
          <details className="mt-4 rounded-xl border border-ds-border-muted bg-ds-main p-3 text-left text-[12px] text-ds-muted">
            <summary className="cursor-pointer font-medium">{t('paperWorkspaceErrorDetails')}</summary>
            <p role="alert" className="mt-2 break-words leading-5">{error}</p>
          </details>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void pick()}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-ds-border px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
          ) : (
            <FolderPlus className="h-4 w-4" strokeWidth={1.9} />
          )}
          {t('paperWorkspaceChooseFolder')}
        </button>

        {candidates && candidates.length > 0 ? (
          <div className="mt-6 text-left">
            <div className="text-[12px] font-semibold text-ds-faint">
              {t('writePaperModeDetectTitle')}
            </div>
            <div className="mt-2 space-y-1.5">
              {candidates.map((candidate) => (
                <button
                  key={candidate.workspaceRoot}
                  type="button"
                  disabled={busy}
                  onClick={() => void adopt(candidate.workspaceRoot)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-ds-border-muted bg-white/55 px-3 py-2 text-left transition hover:border-accent-tint/30 hover:bg-white/80 disabled:opacity-60 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ds-ink">
                      {candidate.workspaceRoot}
                    </span>
                    <span className="block text-[11.5px] text-ds-faint">
                      {t('writePaperModeDetectUnits', { count: candidate.unitCount })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
