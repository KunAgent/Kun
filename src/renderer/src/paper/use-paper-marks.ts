import { useEffect, useRef } from 'react'
import { paperAnnotationsFileSchema, type PaperHighlight, mergePaperHighlights } from '@shared/paper/paper-marks-types'
import { activatePaperMarksUnit, getPaperMarksDraft, updatePaperMarksDraft, usePaperMarksStore } from './paper-marks-store'
import { usePaperStore } from '../write/paper/paper-store'
import i18n from '../i18n'

function reportMarksError(unitDir: string, error: unknown, retry: () => void): void {
  usePaperStore.getState().setNotice({
    tone: 'error',
    message: i18n.t('common:writePaperErrorGeneric', { message: `${unitDir}/marks: ${error instanceof Error ? error.message : String(error)}` }),
    action: { label: i18n.t('common:paperWorkspaceRetry'), run: retry }
  })
}

function parseMarks(items: unknown[]): { items: PaperHighlight[]; cards: Record<string, unknown> } {
  const annotations = paperAnnotationsFileSchema.safeParse({
    version: 1, items: items.filter((item) => (item as { kind?: string })?.kind === 'highlight')
  })
  if (!annotations.success) throw new Error('Invalid marks/annotations.json')
  const cards: Record<string, unknown> = {}
  for (const item of items as { id?: string; kind?: string }[]) {
    if (item.kind && item.kind !== 'highlight' && item.id) cards[item.id] = item
  }
  return { items: annotations.data.items, cards }
}

/** Load source-owned marks, retaining unsaved units across reader navigation. */
export function usePaperMarks(workspaceRoot: string, unitDir: string, enabled = true): void {
  const saveTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    activatePaperMarksUnit(workspaceRoot, unitDir)
    if (!workspaceRoot || !unitDir) return
    let active = true
    const load = async (): Promise<void> => {
      try {
        if (typeof window.kunGui?.paperMarksRead !== 'function') throw new Error('Paper marks are unavailable.')
        const result = await window.kunGui.paperMarksRead({ workspaceRoot, unitDir })
        if (!active) return
        if (!result.ok) throw new Error(result.message)
        const incoming = parseMarks(result.items)
        updatePaperMarksDraft(workspaceRoot, unitDir, (state) => {
          const removed = new Set(state.removedIds)
          const items = incoming.items.filter((item) => !removed.has(item.id))
          const cards = state.dirty ? { ...incoming.cards, ...state.cards } : { ...incoming.cards }
          for (const id of removed) delete cards[id]
          return {
            items: state.dirty ? mergePaperHighlights(items, state.items) : items,
            cards, revision: state.revision + 1
          }
        })
      } catch (error) {
        if (active) reportMarksError(unitDir, error, () => { if (active) void load() })
      }
    }
    void load()
    const onFocus = (): void => {
      if (!usePaperMarksStore.getState().dirty) void load()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void flushPaperMarks(workspaceRoot, unitDir)
    }
  }, [workspaceRoot, unitDir, enabled])

  useEffect(() => {
    if (!enabled) return
    const schedule = (): void => {
      const state = usePaperMarksStore.getState()
      if (!state.dirty || state.workspaceRoot !== workspaceRoot || state.unitDir !== unitDir || !workspaceRoot) return
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushPaperMarks(workspaceRoot, unitDir)
      }, 600)
    }
    const unsubscribe = usePaperMarksStore.subscribe((state, previous) => {
      if (state.items !== previous.items || state.cards !== previous.cards || state.removedIds !== previous.removedIds || state.dirty !== previous.dirty) schedule()
    })
    schedule()
    return unsubscribe
  }, [workspaceRoot, unitDir, enabled])
}

/** A retry may save a pending unit without replacing the currently open paper. */
export async function flushPaperMarks(workspaceRoot: string, unitDir: string): Promise<void> {
  const current = getPaperMarksDraft(workspaceRoot, unitDir)
  if (!workspaceRoot || !unitDir || !current?.dirty) return
  const sentItems = current.items
  const sentCards = current.cards
  const sentRemoved = current.removedIds
  try {
    if (typeof window.kunGui?.paperMarksWrite !== 'function') throw new Error('Paper marks are unavailable.')
    const result = await window.kunGui.paperMarksWrite({
      workspaceRoot, unitDir, items: [...sentItems, ...Object.values(sentCards)], removedIds: sentRemoved
    })
    if (!result.ok) throw new Error(result.message)
    const written = parseMarks(result.items)
    updatePaperMarksDraft(workspaceRoot, unitDir, (state) => {
      const stillDirty = state.items !== sentItems || state.cards !== sentCards || state.removedIds !== sentRemoved
      const removed = new Set(state.removedIds)
      const cards = { ...written.cards, ...state.cards }
      for (const id of removed) delete cards[id]
      return {
        items: mergeIntoState(state.items, written.items.filter((item) => !removed.has(item.id))),
        cards,
        removedIds: stillDirty ? state.removedIds.filter((id) => !sentRemoved.includes(id)) : [],
        dirty: stillDirty, revision: state.revision + 1
      }
    })
  } catch (error) {
    updatePaperMarksDraft(workspaceRoot, unitDir, () => ({ dirty: true }))
    reportMarksError(unitDir, error, () => { void flushPaperMarks(workspaceRoot, unitDir) })
  }
}

function mergeIntoState(local: readonly PaperHighlight[], written: readonly PaperHighlight[]): PaperHighlight[] {
  const localIds = new Set(local.map((item) => item.id))
  const extras = written.filter((item) => !localIds.has(item.id))
  return extras.length ? [...local, ...extras] : [...local]
}
