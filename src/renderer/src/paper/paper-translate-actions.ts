import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { nextPaperMarkId, usePaperMarksStore } from './paper-marks-store'
import type { PaperRect } from '@shared/paper/paper-marks-types'

/**
 * Translation actions (plan §6.5): selection → translate card (saved as a
 * `marks/<id>.json` translate mark), document → chunked `<slug>-译文.md` job
 * surfaced through `paper:progress` events.
 */

export type PaperTranslateSelectionResult =
  | { ok: true; markId: string; translation: string }
  | { ok: false; message: string }

export async function translatePaperSelection(input: {
  unitDir: string
  page: number
  rects: PaperRect[]
  text: string
}): Promise<PaperTranslateSelectionResult> {
  const state = useWriteWorkspaceStore.getState()
  const translate = state.paperMode.translate
  if (typeof window.kunGui?.paperTranslateSelection !== 'function') {
    return { ok: false, message: 'Translation bridge unavailable.' }
  }
  const result = await window.kunGui.paperTranslateSelection({
    text: input.text,
    targetLanguage: translate.targetLanguage,
    providerId: translate.inheritModel ? undefined : translate.providerId || undefined,
    model: translate.inheritModel ? undefined : translate.model || undefined
  })
  if (!result.ok) return { ok: false, message: result.message }
  const markId = nextPaperMarkId()
  // Register a translate card locally; the marks-write IPC persists cards
  // alongside annotations (per-id files under marks/).
  usePaperMarksStore.setState((s) => ({
    dirty: true,
    cards: {
      ...s.cards,
      [markId]: {
        id: markId,
        kind: 'translate',
        page: input.page,
        rects: input.rects,
        quote: input.text.slice(0, 8000),
        translation: result.translation,
        targetLanguage: translate.targetLanguage,
        model: result.model,
        createdAt: new Date().toISOString()
      }
    }
  }))
  return { ok: true, markId, translation: result.translation }
}

export async function translatePaperDocument(input: {
  unitDir: string
  requestId: string
}): Promise<{ ok: true; outputPath: string } | { ok: false; message: string }> {
  const state = useWriteWorkspaceStore.getState()
  const translate = state.paperMode.translate
  if (typeof window.kunGui?.paperTranslateDocument !== 'function') {
    return { ok: false, message: 'Translation bridge unavailable.' }
  }
  const result = await window.kunGui.paperTranslateDocument({
    workspaceRoot: state.workspaceRoot,
    unitDir: input.unitDir,
    targetLanguage: translate.targetLanguage,
    providerId: translate.inheritModel ? undefined : translate.providerId || undefined,
    model: translate.inheritModel ? undefined : translate.model || undefined,
    requestId: input.requestId
  })
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, outputPath: result.outputPath }
}
