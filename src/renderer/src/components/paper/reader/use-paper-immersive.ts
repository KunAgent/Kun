import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import type { PaperWorkbenchChrome } from '../../../paper/paper-chrome-context'

/**
 * Immersive reading mode (R1.2): hides the tab rail, left sidebar, and right
 * assistant via their real collapsed states (never display:none), caps the
 * PDF column width, and asks for DOM fullscreen when available. If the
 * fullscreen request fails the UI still immerses. Exiting fullscreen
 * (system Esc) also exits immersion; previous collapsed states restore.
 */
export function usePaperImmersive({
  rootRef,
  chrome
}: {
  rootRef: RefObject<HTMLElement | null>
  chrome: PaperWorkbenchChrome | null
}): {
  immersive: boolean
  toggleImmersive: () => void
} {
  const [immersive, setImmersive] = useState(false)
  const savedChromeRef = useRef<{ leftCollapsed: boolean; assistantOpen: boolean } | null>(null)
  const chromeRef = useRef(chrome)
  chromeRef.current = chrome

  const enter = useCallback((): void => {
    savedChromeRef.current = {
      leftCollapsed: chromeRef.current?.leftSidebarCollapsed ?? false,
      assistantOpen: useWriteWorkspaceStore.getState().assistantOpen
    }
    chromeRef.current?.setLeftSidebarCollapsed(true)
    useWriteWorkspaceStore.getState().setAssistantOpen(false)
    // Best-effort DOM fullscreen; UI immersion applies regardless.
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
    setImmersive(true)
  }, [])

  const exit = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined)
    }
    const saved = savedChromeRef.current
    if (saved) {
      chromeRef.current?.setLeftSidebarCollapsed(saved.leftCollapsed)
      useWriteWorkspaceStore.getState().setAssistantOpen(saved.assistantOpen)
      savedChromeRef.current = null
    }
    setImmersive(false)
  }, [])

  const toggleImmersive = useCallback((): void => {
    if (immersive) exit()
    else enter()
  }, [immersive, enter, exit])

  // Leaving DOM fullscreen via the system path (Esc / window controls) exits
  // immersion too, restoring the saved chrome states.
  useEffect(() => {
    if (!immersive) return
    const onFullscreenChange = (): void => {
      if (!document.fullscreenElement) exit()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [immersive, exit])

  // Unmounting an immersed reader restores chrome.
  useEffect(() => () => {
    if (savedChromeRef.current) {
      const saved = savedChromeRef.current
      chromeRef.current?.setLeftSidebarCollapsed(saved.leftCollapsed)
      useWriteWorkspaceStore.getState().setAssistantOpen(saved.assistantOpen)
      savedChromeRef.current = null
    }
  }, [])

  void rootRef
  return { immersive, toggleImmersive }
}
