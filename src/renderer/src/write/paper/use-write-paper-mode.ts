import { useEffect, useMemo, useRef } from 'react'
import type { PaperUnitMetaV1 } from '@shared/paper/paper-types'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../write-workspace-store'
import { normalizePath } from '../write-workspace-store-helpers'
import {
  checkPendingInterpretation,
  listPaperUnits,
  refreshPaperUnit
} from './paper-actions'
import { newPaperRequestId, usePaperStore } from './paper-store'
import {
  findPaperUnitDir,
  PAPER_META_FILE,
  paperUnitDirForFile,
  paperUnitDirFromKnownUnits
} from './paper-unit'

export type PaperModeState = {
  /** Absolute dir of the paper unit containing the active file, if any. */
  unitDirAbs: string | null
  /** Workspace-relative unit dir for IPC calls. */
  unitDir: string | null
  meta: PaperUnitMetaV1 | null
  /** Active file is a PDF outside any paper unit → offer "作为论文打开". */
  loosePdf: boolean
}

const PAPER_NOTICE_MS = 6000

/**
 * Wires the paper-reading feature into the Write workspace:
 * - subscribes to `paper:progress` job events,
 * - resolves the paper unit containing the active file (from loaded dir
 *   entries; falls back to an IPC probe for unloaded trees),
 * - lists units for the sidebar when the workspace changes,
 * - resolves a pending interpretation once the assistant turn goes idle,
 * - auto-dismisses the paper notice banner.
 */
export function useWritePaperMode(workspaceRoot: string): PaperModeState {
  const activeFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const activeFileKind = useWriteWorkspaceStore((s) => s.activeFileKind)
  const entriesByDir = useWriteWorkspaceStore((s) => s.entriesByDir)
  const papersDir = useWriteWorkspaceStore((s) => s.paperReading.papersDir)
  const busy = useChatStore((s) => s.busy)

  const knownUnitDirs = usePaperStore((s) => Object.keys(s.unitsByDir).join('\n'))
  const unitDirAbs = useMemo(
    () =>
      findPaperUnitDir(workspaceRoot, activeFilePath, entriesByDir) ??
      paperUnitDirFromKnownUnits(
        workspaceRoot,
        activeFilePath,
        knownUnitDirs ? knownUnitDirs.split('\n') : []
      ),
    [workspaceRoot, activeFilePath, entriesByDir, knownUnitDirs]
  )
  const unitDir = unitDirAbs ? paperUnitDirForFile(unitDirAbs, workspaceRoot) : null
  const meta = usePaperStore((s) => (unitDir ? (s.unitsByDir[normalizePath(unitDir)] ?? null) : null))

  // Progress events → job state for the toolbar/dialog.
  useEffect(() => {
    if (typeof window.kunGui?.onPaperProgress !== 'function') return
    return window.kunGui.onPaperProgress((event) => {
      usePaperStore.getState().applyProgress(event)
    })
  }, [])

  // Sidebar listing + store reset when the workspace changes.
  useEffect(() => {
    if (!workspaceRoot) return
    usePaperStore.getState().reset()
    void listPaperUnits(workspaceRoot, papersDir)
  }, [workspaceRoot, papersDir])

  // Resolve meta for the active paper unit (bar needs title/authors/links).
  useEffect(() => {
    if (!workspaceRoot || !unitDir || meta) return
    let canceled = false
    void (async () => {
      const read = await window.kunGui.paperReadUnit({ workspaceRoot, unitDir })
      if (!canceled && read.ok) {
        usePaperStore.getState().rememberUnit(read.unitDir, read.meta)
      }
    })()
    return () => {
      canceled = true
    }
  }, [workspaceRoot, unitDir, meta])

  // Turn-end detection: the interpretation file should exist by now.
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (busy) {
      wasBusyRef.current = true
      return
    }
    if (!wasBusyRef.current) return
    wasBusyRef.current = false
    if (usePaperStore.getState().pendingInterpretation && workspaceRoot) {
      void checkPendingInterpretation(workspaceRoot)
    }
  }, [busy, workspaceRoot])

  // Auto-dismiss the paper notice.
  const notice = usePaperStore((s) => s.notice)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => {
      usePaperStore.getState().setNotice(null)
    }, PAPER_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loosePdf = Boolean(
    activeFileKind === 'pdf' &&
      activeFilePath &&
      !unitDirAbs &&
      workspaceRoot &&
      normalizePath(activeFilePath).startsWith(`${normalizePath(workspaceRoot)}/`)
  )

  return { unitDirAbs, unitDir, meta, loosePdf }
}

export { newPaperRequestId, PAPER_META_FILE, refreshPaperUnit }
