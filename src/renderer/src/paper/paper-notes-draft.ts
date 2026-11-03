import { create } from 'zustand'
import i18n from '../i18n'
import { confirmDialog } from '../lib/confirm-dialog'
import { PAPER_NOTES_FILE_NAME } from '@shared/paper/paper-types'
import { writeJoinPath } from '../write/write-workspace-store-helpers'
import { paperSpaceItemKey } from './paper-space-store'

export type PaperNotesDraft = {
  workspaceRoot: string
  unitDir: string
  text: string
  saved: string
  mtimeMs?: number
  missing: boolean
  status: 'loading' | 'ready' | 'error'
  error: string | null
  saving: boolean
}

/** Drafts survive route changes; a source is never inferred from the mounted Work folder. */
export const usePaperNotesDraftStore = create<{ drafts: Record<string, PaperNotesDraft> }>(() => ({ drafts: {} }))
const loads = new Map<string, number>()
const saves = new Map<string, Promise<boolean>>()

function patch(key: string, update: Partial<PaperNotesDraft>): void {
  usePaperNotesDraftStore.setState((state) => state.drafts[key]
    ? { drafts: { ...state.drafts, [key]: { ...state.drafts[key], ...update } } }
    : state)
}

export function hasUnsavedPaperNotes(): boolean {
  return Object.values(usePaperNotesDraftStore.getState().drafts).some((draft) => draft.text !== draft.saved || draft.saving)
}

const beforeUnload = (event: BeforeUnloadEvent): void => {
  if (!hasUnsavedPaperNotes()) return
  event.preventDefault()
  event.returnValue = ''
}
let unloadWindow: Window | undefined
usePaperNotesDraftStore.subscribe(() => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  if (hasUnsavedPaperNotes() && unloadWindow !== window) {
    unloadWindow?.removeEventListener('beforeunload', beforeUnload)
    window.addEventListener('beforeunload', beforeUnload)
    unloadWindow = window
  } else if (!hasUnsavedPaperNotes() && unloadWindow) {
    unloadWindow.removeEventListener('beforeunload', beforeUnload)
    unloadWindow = undefined
  }
})

export async function loadPaperNotesDraft(workspaceRoot: string, unitDir: string): Promise<void> {
  const key = paperSpaceItemKey(workspaceRoot, unitDir)
  const previous = usePaperNotesDraftStore.getState().drafts[key]
  if (previous && (previous.text !== previous.saved || previous.saving)) return
  const request = (loads.get(key) ?? 0) + 1
  loads.set(key, request)
  usePaperNotesDraftStore.setState((state) => ({ drafts: {
    ...state.drafts,
    [key]: { workspaceRoot, unitDir, text: previous?.text ?? '', saved: previous?.saved ?? '',
      mtimeMs: previous?.mtimeMs, missing: false, status: 'loading', error: null, saving: false }
  } }))
  try {
    const result = await window.kunGui.readWorkspaceFile({ workspaceRoot, path: writeJoinPath(unitDir, PAPER_NOTES_FILE_NAME) })
    if (loads.get(key) !== request) return
    if (!result.ok) {
      if (result.code === 'not_found') patch(key, { text: '', saved: '', mtimeMs: undefined, missing: true, status: 'ready' })
      else patch(key, { status: 'error', error: result.message })
    } else if (result.truncated) {
      patch(key, { status: 'error', error: i18n.t('common:mobileWorkPaperNotesLarge') })
    } else {
      patch(key, { text: result.content, saved: result.content, mtimeMs: result.mtimeMs, status: 'ready', missing: false })
    }
  } catch (error) {
    if (loads.get(key) === request) patch(key, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

export function editPaperNotesDraft(key: string, text: string): void {
  const draft = usePaperNotesDraftStore.getState().drafts[key]
  if (draft?.status === 'ready') patch(key, { text })
}

export async function savePaperNotesDraft(key: string): Promise<boolean> {
  const existing = saves.get(key)
  if (existing) return existing
  const draft = usePaperNotesDraftStore.getState().drafts[key]
  if (!draft || draft.status !== 'ready') return false
  if (draft.text === draft.saved) return true
  const snapshot = draft.text
  patch(key, { saving: true, error: null })
  const operation = Promise.resolve().then(async (): Promise<boolean> => {
    try {
      const input = { workspaceRoot: draft.workspaceRoot, path: writeJoinPath(draft.unitDir, PAPER_NOTES_FILE_NAME), content: snapshot }
      if (draft.missing) {
        // Create, rather than overwrite a file that appeared since the initial read.
        const created = await window.kunGui.createWorkspaceFile(input)
        if (!created.ok) throw new Error(created.message)
        const read = await window.kunGui.readWorkspaceFile({ workspaceRoot: draft.workspaceRoot, path: input.path })
        if (!read.ok) throw new Error(read.message)
        if (read.content !== snapshot) throw new Error(i18n.t('common:mobileWorkPaperNotesConflict'))
        patch(key, { saved: snapshot, mtimeMs: read.mtimeMs, missing: false })
      } else {
        const result = await window.kunGui.writeWorkspaceFile({ ...input, expectedMtimeMs: draft.mtimeMs })
        if (!result.ok) throw new Error(result.code === 'modified_on_disk'
          ? i18n.t('common:mobileWorkPaperNotesConflict') : result.message)
        patch(key, { saved: snapshot, mtimeMs: result.mtimeMs })
      }
      const current = usePaperNotesDraftStore.getState().drafts[key]
      return current?.text === snapshot
    } catch (error) {
      patch(key, { error: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      patch(key, { saving: false })
      saves.delete(key)
    }
  })
  saves.set(key, operation)
  return operation
}

export async function reloadPaperNotesDraft(key: string): Promise<void> {
  const draft = usePaperNotesDraftStore.getState().drafts[key]
  if (!draft || draft.saving) return
  if (draft.text !== draft.saved && !(await confirmDialog(i18n.t('common:paperSpaceNotesDiscardConfirm')))) return
  patch(key, { text: draft.saved })
  await loadPaperNotesDraft(draft.workspaceRoot, draft.unitDir)
}

export async function preparePaperNotesForNavigation(): Promise<boolean> {
  const dirty = Object.entries(usePaperNotesDraftStore.getState().drafts).filter(([, draft]) => draft.text !== draft.saved || draft.saving)
  if (!dirty.length) return true
  if (await confirmDialog(i18n.t('common:paperSpaceNotesSaveConfirm'))) {
    for (const [key] of dirty) if (!(await savePaperNotesDraft(key))) return false
    return !hasUnsavedPaperNotes()
  }
  if (!(await confirmDialog(i18n.t('common:paperSpaceNotesDiscardConfirm')))) return false
  for (const [key, draft] of dirty) {
    if (draft.saving) return false
    patch(key, { text: draft.saved, error: null })
  }
  return true
}
