import { useEffect, useRef } from 'react'
import {
  paperAnnotationsFileSchema,
  type PaperHighlight,
  mergePaperHighlights
} from '@shared/paper/paper-marks-types'
import { usePaperMarksStore } from './paper-marks-store'

/**
 * Load `marks/` for a unit and flush local edits (600ms debounce). The IPC
 * write merges by id on the main side, so highlights the Agent appended
 * between our load and save survive; external writes are reloaded on window
 * focus.
 */
export function usePaperMarks(workspaceRoot: string, unitDir: string): void {
  const saveTimerRef = useRef<number | null>(null)
  const revisionRef = useRef(0)

  useEffect(() => {
    const store = usePaperMarksStore
    store.setState({ unitDir, items: [], cards: {}, removedIds: [], dirty: false })
    if (!workspaceRoot || !unitDir) return
    if (typeof window.kunGui?.paperMarksRead !== 'function') return

    const load = async (): Promise<void> => {
      const result = await window.kunGui.paperMarksRead({ workspaceRoot, unitDir })
      if (!result.ok) return
      const annotations = paperAnnotationsFileSchema.safeParse({
        version: 1,
        items: (result.items as unknown[]).filter(
          (item) => (item as { kind?: string })?.kind === 'highlight'
        )
      })
      const cards: Record<string, unknown> = {}
      for (const item of result.items as { id?: string; kind?: string }[]) {
        if (item.kind && item.kind !== 'highlight' && item.id) cards[item.id] = item
      }
      usePaperMarksStore.setState((state) => {
        if (state.unitDir !== unitDir) return state
        const removed = new Set(state.removedIds)
        const incoming = (annotations.success ? annotations.data.items : []).filter(
          (item) => !removed.has(item.id)
        )
        // Merge rather than replace so edits made while loading aren't lost.
        const items = state.dirty ? mergePaperHighlights(incoming, state.items) : incoming
        return { items, cards, revision: state.revision + 1 }
      })
    }
    void load()

    const onFocus = (): void => {
      // External (Agent) writes: re-read only when we have no pending edits.
      if (!usePaperMarksStore.getState().dirty) void load()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [workspaceRoot, unitDir])

  // Debounced flush of dirty marks.
  useEffect(() => {
    const unsubscribe = usePaperMarksStore.subscribe((state) => {
      if (!state.dirty || state.unitDir !== unitDir || !workspaceRoot) return
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(async () => {
        saveTimerRef.current = null
        const current = usePaperMarksStore.getState()
        if (current.unitDir !== unitDir) return
        const sentItems = current.items
        const sentRemoved = current.removedIds
        const result = await window.kunGui.paperMarksWrite({
          workspaceRoot,
          unitDir,
          items: [...sentItems, ...Object.values(current.cards)],
          removedIds: sentRemoved
        })
        if (!result.ok) return
        usePaperMarksStore.setState((state) => {
          const stillDirty = state.items !== sentItems || state.removedIds !== sentRemoved
          return {
            items: mergeIntoState(state.items, result.items as PaperHighlight[]),
            removedIds: stillDirty
              ? state.removedIds.filter((id) => !sentRemoved.includes(id))
              : [],
            dirty: stillDirty,
            revision: state.revision + 1
          }
        })
      }, 600)
    })
    return unsubscribe
  }, [workspaceRoot, unitDir])

  // Keep revisionRef warm for future conflict UIs.
  revisionRef.current = usePaperMarksStore.getState().revision
}

/** After a successful write, merge server-side extras (Agent-added) back in. */
function mergeIntoState(
  local: readonly PaperHighlight[],
  written: readonly PaperHighlight[]
): PaperHighlight[] {
  const localIds = new Set(local.map((item) => item.id))
  const extras = written.filter((item) => !localIds.has(item.id))
  return extras.length ? [...local, ...extras] : [...local]
}
