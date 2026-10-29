import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowLeft, Loader2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { readPaperReaderLayout, storePaperReaderLayout, type PaperReaderLayoutPreset } from '../../paper/paper-reader-layout'
import { loadPaperNotesDraft, preparePaperNotesForNavigation, savePaperNotesDraft, usePaperNotesDraftStore } from '../../paper/paper-notes-draft'
import { paperSpaceItemKey } from '../../paper/paper-space-store'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { PaperUnitPdfReader } from './reader/PaperUnitPdfReader'
import { PaperReaderHostContext, type PaperReaderHost } from './reader/paper-reader-host'
import { PapersNotesPane } from './reader/PapersNotesPane'
import type { PendingPaperSelection } from './reader/use-paper-selection'
import { PaperMetaEditDialog } from './library/PaperMetaEditDialog'
import type { PaperSpaceImage } from '../../paper/paper-space-assistant'
import { refreshPaperSpace } from '../../paper/paper-space'

type PdfSource = { key: string; filePath: string; dataBase64: string; size: number; mtimeMs: number }
export type PapersReaderProps = {
  workspaceRoot: string
  entry: PaperLibraryEntry
  onBack: () => void
  onSubmitPrompt?: (prompt: string, images?: readonly PaperSpaceImage[]) => void
}

/** Owns a source-scoped reader without changing the Work folder or document tabs. */
export function PapersReader({ workspaceRoot, entry, onBack, onSubmitPrompt }: PapersReaderProps): ReactElement {
  const { t } = useTranslation('common')
  const unitDir = entry.unitDir
  const sourceKey = paperSpaceItemKey(workspaceRoot, unitDir)
  const notesError = usePaperNotesDraftStore((state) => state.drafts[sourceKey]?.error)
  const unitDirAbs = writeJoinPath(workspaceRoot, unitDir)
  const pdfPath = entry.hasPdf && entry.meta.pdfFile ? writeJoinPath(unitDirAbs, entry.meta.pdfFile) : ''
  const sequence = useRef(0)
  const currentKey = useRef(sourceKey)
  currentKey.current = sourceKey
  const [pdf, setPdf] = useState<PdfSource | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [layoutPreset, setLayoutPreset] = useState<PaperReaderLayoutPreset>(readPaperReaderLayout)
  const [prompt, setPrompt] = useState('')
  const images = useRef<PaperSpaceImage[]>([])
  const submit = useCallback((text: string): void => {
    onSubmitPrompt?.(text, [...images.current]); images.current = []
  }, [onSubmitPrompt])
  const [translated, setTranslated] = useState<{ path: string; text: string } | null>(null)
  const [translationError, setTranslationError] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)

  const loadPdf = useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    setPdfError(null)
    if (!pdfPath) { setPdfLoading(false); return }
    setPdfLoading(true)
    try {
      const result = await window.kunGui.readWorkspacePdf({ workspaceRoot, path: pdfPath })
      if (request !== sequence.current || currentKey.current !== sourceKey) return
      if (result.ok) setPdf({ key: sourceKey, filePath: result.path, dataBase64: result.dataBase64, size: result.size, mtimeMs: result.mtimeMs })
      else setPdfError(result.message)
    } catch (error) {
      if (request === sequence.current && currentKey.current === sourceKey) setPdfError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request === sequence.current && currentKey.current === sourceKey) setPdfLoading(false)
    }
  }, [pdfPath, sourceKey, workspaceRoot])

  useEffect(() => {
    setTranslated(null)
    setTranslationError('')
    setPrompt('')
    images.current = []
    void loadPdf()
    void loadPaperNotesDraft(workspaceRoot, unitDir)
    return () => { sequence.current += 1 }
  }, [loadPdf, workspaceRoot, unitDir])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void savePaperNotesDraft(sourceKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sourceKey])

  const leave = useCallback(async (): Promise<void> => {
    if (await preparePaperNotesForNavigation()) onBack()
  }, [onBack])
  const applyLayout = useCallback((preset: PaperReaderLayoutPreset): void => {
    storePaperReaderLayout(preset)
    setLayoutPreset(preset)
  }, [])
  const quote = useCallback((selection: PendingPaperSelection): string =>
    `${t('paperSpaceSelectionPage', { page: selection.page })}\n> ${selection.text.replace(/\n/g, '\n> ')}`, [t])
  const host = useMemo<PaperReaderHost>(() => ({
    entry,
    onShowInfo: () => setInfoOpen(true),
    layoutPreset,
    applyLayout,
    onBack: () => { void leave() },
    onSubmitPrompt: submit,
    // Quoting stages a draft; it is not permission to send a model request.
    onQuoteSelection: (selection) => { setPrompt(quote(selection)); applyLayout('assistant') },
    onAskSelection: (question, selection) => { submit(`${question}\n\n${quote(selection)}`) },
    onOpenTranslated: (outputPath) => {
      const capturedKey = sourceKey
      const request = sequence.current
      const path = outputPath.replace(/\\/g, '/')
      const resolved = path.startsWith(`${unitDir}/`) || path.startsWith(`${workspaceRoot.replace(/\/$/, '')}/`) || /^[A-Za-z]:\//.test(path)
        ? path : writeJoinPath(unitDir, path)
      setTranslationError('')
      void window.kunGui.readWorkspaceFile({ workspaceRoot, path: resolved }).then((result) => {
        if (currentKey.current !== capturedKey || sequence.current !== request) return
        if (!result.ok) { setTranslationError(result.message); return }
        setTranslated({ path: resolved, text: result.content })
        applyLayout('notes')
      }).catch((error: unknown) => { if (currentKey.current === capturedKey && sequence.current === request) setTranslationError(String(error)) })
    },
    onAttachImage: async (image) => { images.current.push(image); applyLayout('assistant'); return true }
  }), [entry, applyLayout, layoutPreset, leave, submit, quote, sourceKey, unitDir, workspaceRoot])

  const shownPdf = pdf?.key === sourceKey ? pdf : null
  const showNotes = !pdfPath || layoutPreset === 'notes'
  const fallbackHeader = !shownPdf ? <header className="papers-reader-header">
    <button type="button" className="papers-text-button" onClick={() => void leave()}><ArrowLeft size={15} />{t('workSidebarLibrary')}</button>
    <h2>{entry.meta.title}</h2>
    <button type="button" className="papers-text-button" onClick={() => applyLayout('notes')}>{t('paperSpaceNotes')}</button>
    <button type="button" className="papers-text-button" onClick={() => applyLayout('assistant')}>{t('paperSpaceAssistant')}</button>
  </header> : null
  return <PaperReaderHostContext.Provider value={host}>
    <div className="papers-reader">
      {fallbackHeader}
      {pdfError ? <div className="papers-notes-error" role="alert"><p>{pdfError}</p><button type="button" className="papers-text-button" disabled={pdfLoading} onClick={() => void loadPdf()}>{t('paperWorkspaceRetry')}</button></div> : null}
      {translationError ? <div className="papers-notes-error" role="alert">{translationError}</div> : null}
      {!showNotes && notesError ? <div className="papers-notes-error" role="alert">{notesError}<button type="button" className="papers-text-button" onClick={() => applyLayout('notes')}>{t('paperSpaceNotes')}</button></div> : null}
      <div className="papers-reader-panels">
        {pdfPath ? <div className="papers-reader-pdf">
          {shownPdf ? <PaperUnitPdfReader filePath={shownPdf.filePath} dataBase64={shownPdf.dataBase64} size={shownPdf.size} mtimeMs={shownPdf.mtimeMs}
            workspaceRoot={workspaceRoot} unitDirAbs={unitDirAbs} onSelectionChange={() => undefined} />
            : <div className="papers-reader-state" role="status">{pdfLoading ? <><Loader2 size={18} className="animate-spin" />{t('loading')}</> : null}</div>}
        </div> : <div className="papers-reader-metadata"><p>{t('writePaperMissingPdf')}</p><p>{entry.meta.abstract}</p></div>}
        {showNotes ? <PapersNotesPane key={sourceKey} draftKey={sourceKey} translated={translated} /> : null}
        {layoutPreset === 'assistant' ? <aside className="papers-reader-assistant">
          <h2>{t('paperSpaceAssistant')}</h2>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label={t('paperSpaceAskPaper')} placeholder={t('paperSpaceAskPaper')} />
          <button type="button" className="papers-button is-primary" disabled={!prompt.trim() || !onSubmitPrompt} onClick={() => {
            submit(prompt.trim()); setPrompt('')
          }}><Send size={14} />{t('paperSpaceSend')}</button>
        </aside> : null}
      </div>
      {infoOpen ? <PaperMetaEditDialog entry={entry} libraryRoot={workspaceRoot} onClose={() => { setInfoOpen(false); void refreshPaperSpace() }} /> : null}
    </div>
  </PaperReaderHostContext.Provider>
}
