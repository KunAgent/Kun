import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DailyNoteSnapshot, DailyNotesApi } from '@shared/daily-notes'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
type Page = { day: string; markdown: string; status: SaveStatus }
type Draft = Page & {
  revision: string
  pending?: Promise<void>
  refresh: number
}

const unsavedDrafts = new Map<string, DailyNoteSnapshot>()

function readDraft(key: string): DailyNoteSnapshot | undefined {
  const remembered = unsavedDrafts.get(key)
  if (remembered) return remembered
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof saved?.markdown === 'string' && typeof saved?.revision === 'string') {
      return { markdown: saved.markdown, revision: saved.revision }
    }
  } catch { /* The open editor can still retain the draft. */ }
  return undefined
}

function writeDraft(key: string, markdown: string, revision: string): void {
  const snapshot = { markdown, revision }
  unsavedDrafts.set(key, snapshot)
  try { localStorage.setItem(key, JSON.stringify(snapshot)) } catch { /* Keep the in-memory draft. */ }
}

function clearDraft(key: string, markdown: string, revision: string): void {
  const stored = readDraft(key)
  if (stored?.markdown !== markdown || stored.revision !== revision) return
  unsavedDrafts.delete(key)
  try { localStorage.removeItem(key) } catch { /* Storage may be unavailable. */ }
}

function isClean(draft: Draft): boolean {
  return draft.status === 'idle' || draft.status === 'saved'
}

export function useNoteDraft(
  api: DailyNotesApi,
  surface: 'window' | 'docked',
  recordSummary: (day: string, markdown: string) => void,
  onSaved: (day: string) => void
) {
  const [page, setPage] = useState<Page>()
  const current = useRef<Draft>(undefined)
  const draftKey = useCallback((day: string) => `kun.dailyNotes.draft.v1.${surface}.${day}`, [surface])

  const publish = useCallback((target: Draft) => {
    if (current.current !== target) return
    const { day, markdown, status } = target
    setPage({ day, markdown, status })
  }, [])

  const replace = useCallback((day: string, note: DailyNoteSnapshot) => {
    const stored = readDraft(draftKey(day))
    const target: Draft = { day, ...note, status: note.markdown ? 'saved' : 'idle', refresh: 0 }
    if (stored && stored.markdown !== note.markdown) {
      Object.assign(target, stored)
      target.status = stored.revision === note.revision ? 'error' : 'conflict'
    } else if (stored) {
      clearDraft(draftKey(day), stored.markdown, stored.revision)
    }
    current.current = target
    recordSummary(day, target.markdown)
    publish(target)
  }, [draftKey, publish, recordSummary])

  const save = useCallback((target: Draft) => {
    if (target.pending || target.status === 'conflict') return
    target.status = 'saving'
    publish(target)
    target.pending = (async () => {
      const key = draftKey(target.day)
      for (;;) {
        const { markdown, revision } = target
        const result = await api.save(target.day, markdown, revision)
        if (result.status === 'conflict') {
          target.status = 'conflict'
          return
        }
        if (current.current === target) onSaved(target.day)
        const latest = target.markdown
        const stored = readDraft(key)
        const ownsStoredDraft = stored?.markdown === latest && stored.revision === revision
        target.revision = result.revision
        if (latest === markdown) {
          clearDraft(key, markdown, revision)
          target.status = 'saved'
          return
        }
        // Only a successful save advances the base of edits made during I/O.
        if (!ownsStoredDraft) {
          target.status = 'conflict'
          return
        }
        writeDraft(key, latest, result.revision)
      }
    })().catch(() => {
      target.status = 'error'
    }).finally(() => {
      target.pending = undefined
      publish(target)
    })
  }, [api, draftKey, onSaved, publish])

  const edit = useCallback((day: string, markdown: string) => {
    const target = current.current
    if (!target || target.day !== day || target.markdown === markdown) return
    target.refresh += 1
    target.markdown = markdown
    writeDraft(draftKey(day), markdown, target.revision)
    recordSummary(day, markdown)
    save(target)
    publish(target)
  }, [draftKey, publish, recordSummary, save])

  const finish = useCallback(async (): Promise<boolean> => {
    const target = current.current
    if (!target) return true
    while (target.pending) await target.pending
    return isClean(target)
  }, [])

  const refresh = useCallback(async (day: string): Promise<void> => {
    const target = current.current
    if (!target || target.day !== day) return
    const request = ++target.refresh
    await target.pending
    if (!isClean(target) || current.current !== target || target.refresh !== request) return
    const latest = await api.read(day)
    if (!isClean(target) || current.current !== target || target.refresh !== request) return
    if (target.revision === latest.revision && target.markdown === latest.markdown) return
    // Install the revision and its editor content together before the next input.
    flushSync(() => {
      Object.assign(target, latest, { status: latest.markdown ? 'saved' : 'idle' })
      recordSummary(day, latest.markdown)
      publish(target)
    })
  }, [api, publish, recordSummary])

  const retry = useCallback(() => {
    const target = current.current
    if (target?.status === 'error') save(target)
  }, [save])

  const copyDraftAndReload = useCallback(async () => {
    const target = current.current
    if (target?.status !== 'conflict') return
    const { day, markdown, revision } = target
    await navigator.clipboard.writeText(markdown)
    const latest = await api.read(day)
    if (current.current !== target || target.markdown !== markdown || target.status !== 'conflict') return
    clearDraft(draftKey(day), markdown, revision)
    replace(day, latest)
  }, [api, draftKey, replace])

  return { current, page, replace, edit, finish, refresh, retry, copyDraftAndReload }
}
