import { useEffect, type RefObject } from 'react'
import { WRITE_EXPORT_NOTICE_MS, type WriteNotice } from './write-workspace-view-utils'

type Params = {
  loadWriteSettings: () => void | Promise<void>
  onboardingComplete: boolean
  onboardingDecision: string
  completeOnboarding: () => void
  activeFilePath: string | null
  previewMode: string
  editorPaneRef: RefObject<HTMLDivElement | null>
  exportMenuRef: RefObject<HTMLDivElement | null>
  exportNoticeTimerRef: RefObject<number | null>
  exportMenuOpen: boolean
  exportNotice: WriteNotice | null
  setExportMenuOpen: (open: boolean) => void
  setPointerSelecting: (selecting: boolean) => void
  setExportNotice: (notice: WriteNotice | null) => void
}

export function useWriteWorkspaceViewEffects({
  loadWriteSettings,
  onboardingComplete,
  onboardingDecision,
  completeOnboarding,
  activeFilePath,
  previewMode,
  editorPaneRef,
  exportMenuRef,
  exportNoticeTimerRef,
  exportMenuOpen,
  exportNotice,
  setExportMenuOpen,
  setPointerSelecting,
  setExportNotice
}: Params): void {
  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    if (!onboardingComplete && onboardingDecision === 'complete') completeOnboarding()
  }, [completeOnboarding, onboardingComplete, onboardingDecision])

  useEffect(() => setExportMenuOpen(false), [activeFilePath, previewMode, setExportMenuOpen])

  useEffect(() => {
    const handleDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editorPaneRef.current?.contains(target)) {
        setPointerSelecting(true)
      }
    }
    const handleUp = (): void => setPointerSelecting(false)
    window.addEventListener('pointerdown', handleDown)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [editorPaneRef, setPointerSelecting])

  useEffect(() => {
    if (!exportMenuOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (exportMenuRef.current && target instanceof Node && !exportMenuRef.current.contains(target)) {
        setExportMenuOpen(false)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setExportMenuOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen, exportMenuRef, setExportMenuOpen])

  useEffect(() => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    if (!exportNotice) return
    exportNoticeTimerRef.current = window.setTimeout(() => {
      exportNoticeTimerRef.current = null
      setExportNotice(null)
    }, WRITE_EXPORT_NOTICE_MS)
    return () => {
      if (exportNoticeTimerRef.current) {
        window.clearTimeout(exportNoticeTimerRef.current)
        exportNoticeTimerRef.current = null
      }
    }
  }, [exportNotice, exportNoticeTimerRef, setExportNotice])

  useEffect(() => () => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
  }, [exportNoticeTimerRef])
}
