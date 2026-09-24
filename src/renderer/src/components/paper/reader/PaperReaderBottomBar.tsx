import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FileDown, Languages, Loader2, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { WritePaperModeReaderSettingsV1 } from '@shared/app-settings-types-paper-mode'
import { rendererRuntimeClient } from '../../../agent/runtime-client'
import { confirmDialog } from '../../../lib/confirm-dialog'
import {
  useWriteWorkspaceStore,
  writeJoinPath
} from '../../../write/write-workspace-store'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { translatePaperDocument } from '../../../paper/paper-translate-actions'
import { paperUnitSlugFromDir } from '../../../write/paper/paper-unit'
import { PAPER_TEXT_FILE_NAME } from '@shared/paper/paper-types'

type Tone = WritePaperModeReaderSettingsV1['paperTone']
const TONES: Tone[] = ['white', 'sepia', 'green', 'dark']

/**
 * Reader bottom bar (plan §6.4): paper-tone picker, whole-paper translation
 * (`<slug>-译文.md` with char/token confirm, progress, cancel, cached-chunk
 * resume), and export-annotations-to-NOTES.
 */
export function PaperReaderBottomBar({
  workspaceRoot,
  unitDir,
  t
}: {
  workspaceRoot: string
  unitDir: string
  t: TFunction
}): ReactElement {
  const tone = useWriteWorkspaceStore((s) => s.paperMode.reader.paperTone)
  const markCount = usePaperMarksStore((s) => s.items.length + Object.keys(s.cards).length)
  const job = usePaperStore((s) => s.busy['translate-document'])
  const [notice, setNotice] = useState('')
  const requestIdRef = useRef('')
  const translating = Boolean(job && job.status === 'running')

  // Apply the paper tone to the scroll container via a data attribute.
  useEffect(() => {
    const scroller = document.querySelector('.write-pdf-scroller')
    if (scroller instanceof HTMLElement) scroller.dataset.paperTone = tone
  }, [tone])

  const setTone = (next: Tone): void => {
    useWriteWorkspaceStore.setState((s) => ({
      paperMode: { ...s.paperMode, reader: { ...s.paperMode.reader, paperTone: next } }
    }))
    void rendererRuntimeClient
      .setSettings({ write: { paperMode: { reader: { paperTone: next } } } })
      .catch(() => undefined)
  }

  const runDocumentTranslate = async (): Promise<void> => {
    setNotice('')
    // Confirm with the paper.md size: characters and a ~4 chars/token estimate.
    let chars = 0
    try {
      const read = await window.kunGui.readWorkspaceFile({
        workspaceRoot,
        path: writeJoinPath(unitDir, PAPER_TEXT_FILE_NAME)
      })
      if (read.ok) chars = read.content.length
    } catch {
      chars = 0
    }
    if (!chars) {
      setNotice(t('writePaperReaderTranslateNoText'))
      return
    }
    const confirmed = await confirmDialog(
      t('writePaperReaderTranslateConfirm', {
        chars,
        tokens: Math.ceil(chars / 4)
      })
    )
    if (!confirmed) return

    const requestId = `translate-doc-${Date.now().toString(36)}`
    requestIdRef.current = requestId
    usePaperStore.getState().beginJob('translate-document', requestId)
    try {
      const result = await translatePaperDocument({ unitDir, requestId })
      if (!result.ok) {
        setNotice(result.message)
        return
      }
      setNotice(result.outputPath)
      // Open the translated markdown in the right editor group (plan §6.5).
      const root = useWriteWorkspaceStore.getState().workspaceRoot
      if (root) {
        await useWriteWorkspaceStore.getState().openFile(
          root,
          writeJoinPath(writeJoinPath(root, unitDir), result.outputPath),
          { groupId: 'secondary', viewMode: 'rich' }
        )
      }
    } finally {
      usePaperStore.getState().endJob(requestId)
    }
  }

  const cancelTranslate = (): void => {
    if (requestIdRef.current) {
      void window.kunGui?.paperCancel?.({ requestId: requestIdRef.current })
    }
  }

  const exportAnnotations = async (): Promise<void> => {
    const { items, cards } = usePaperMarksStore.getState()
    if (items.length === 0 && Object.keys(cards).length === 0) return
    const { appendPaperNotes } = await import('../../../paper/paper-notes-append')
    const notesPath = `${unitDir}/${paperUnitSlugFromDir(unitDir)}-NOTES.md`
    await appendPaperNotes({ workspaceRoot, notesPath, items, cards })
    setNotice(t('writePaperReaderNotesExported'))
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-ds-border-muted bg-white/88 px-3 py-1.5 dark:bg-ds-card/95">
      <div className="flex items-center gap-1" role="group" aria-label={t('writePaperReaderTone')}>
        {TONES.map((item) => (
          <button
            key={item}
            type="button"
            title={t(`writePaperReaderTone_${item}`)}
            aria-label={t(`writePaperReaderTone_${item}`)}
            aria-pressed={tone === item}
            className={`paper-tone-${item} h-[18px] w-[18px] rounded-full border ${
              tone === item ? 'ring-2 ring-ds-accent ring-offset-1' : 'border-black/15'
            }`}
            onClick={() => setTone(item)}
          />
        ))}
      </div>
      <span className="text-[11px] text-ds-faint">
        {markCount ? t('writePaperReaderMarkCount', { count: markCount }) : ''}
      </span>
      <div className="flex-1" />
      {notice ? <span className="max-w-[320px] truncate text-[11px] text-ds-muted">{notice}</span> : null}
      {translating ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ds-muted hover:bg-ds-hover"
          onClick={cancelTranslate}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{job?.message ?? t('writePaperReaderTranslating')}</span>
          <X className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ds-muted hover:bg-ds-hover disabled:opacity-50"
          onClick={() => void runDocumentTranslate()}
        >
          <Languages className="h-3.5 w-3.5" />
          {t('writePaperReaderTranslateDoc')}
        </button>
      )}
      <button
        type="button"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ds-muted hover:bg-ds-hover disabled:opacity-50"
        disabled={markCount === 0}
        onClick={() => void exportAnnotations()}
      >
        <FileDown className="h-3.5 w-3.5" />
        {t('writePaperReaderExportNotes')}
      </button>
    </div>
  )
}
