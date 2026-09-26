import { useEffect, useState, type ReactElement } from 'react'
import { FolderOpen, FolderPlus, GraduationCap, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { addPaperLibrary } from '../../paper/paper-mode-actions'
import { usePaperStore } from '../../write/paper/paper-store'
import type { PaperLibraryCandidate } from '@shared/paper/paper-library-types'

/**
 * First-run card for paper mode (§6.1): pick a folder to use as the library
 * root, or adopt an existing workspace that already contains paper units
 * (detected via `paper-library:detect`).
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
    if (pending) return
    setPending(true)
    try {
      const picked = await window.kunGui.pickWorkspaceDirectory(undefined)
      if (!picked.canceled && picked.path) {
        const result = await addPaperLibrary(picked.path)
        if (!result.ok) setFileError(result.message)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    } finally {
      setPending(false)
    }
  }

  const adopt = async (path: string): Promise<void> => {
    if (pending) return
    setPending(true)
    try {
      const result = await addPaperLibrary(path)
      if (!result.ok) {
        usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-[28px] border border-ds-border bg-ds-elevated px-8 py-8 text-center shadow-[0_22px_56px_rgba(20,47,95,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-tint/10 text-accent">
          <GraduationCap className="h-6 w-6" strokeWidth={1.9} />
        </div>
        <h2 className="mt-5 text-[24px] font-semibold tracking-[-0.04em] text-ds-ink">
          {t('writePaperModeOnboardingTitle')}
        </h2>
        <p className="mt-3 text-[14.5px] leading-7 text-ds-muted">
          {t('writePaperModeOnboardingSub')}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void pick()}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(59,130,216,0.22)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
          ) : (
            <FolderPlus className="h-4 w-4" strokeWidth={1.9} />
          )}
          {t('writePaperModePickLibrary')}
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
                  disabled={pending}
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
