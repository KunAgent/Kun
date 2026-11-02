import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowLeft, Loader2, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperReaderLayoutPreset } from '../../paper/paper-reader-layout'
import { loadPaperNotesDraft, preparePaperNotesForNavigation, savePaperNotesDraft, usePaperNotesDraftStore } from '../../paper/paper-notes-draft'
import { paperSpaceItemKey } from '../../paper/paper-space-store'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { PaperUnitPdfReader } from './reader/PaperUnitPdfReader'
import { PaperReaderHostContext, type PaperReaderHost } from './reader/paper-reader-host'
import { PapersNotesPane } from './reader/PapersNotesPane'
import type { PendingPaperSelection } from './reader/use-paper-selection'
import { PaperMetaEditDialog } from './library/PaperMetaEditDialog'
import { openPaperSpaceAssistant, type PaperSpaceImage } from '../../paper/paper-space-assistant'
import { EMPTY_PAPER_ASSISTANT, paperAssistantSession, patchPaperAssistant, quoteForPaperAssistant, usePaperAssistantStore } from '../../paper/paper-space-assistant-state'
import { PapersAssistantPanel } from './PapersAssistantPanel'
import { refreshPaperSpace } from '../../paper/paper-space'

type PdfSource = { key: string; filePath: string; dataBase64: string; size: number; mtimeMs: number }
export type PapersReaderProps = {
  workspaceRoot: string
  entry: PaperLibraryEntry
  onBack: () => void
  onSubmitPrompt?: (prompt: string, images?: readonly PaperSpaceImage[]) => void
}

/** Owns a source-scoped PDF tab without changing the current Work folder. */
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
  const session = usePaperAssistantStore((state) => state.sessions[sourceKey] ?? EMPTY_PAPER_ASSISTANT)
  const layoutPreset = session.layout
  const readerRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [assistantExpanded, setAssistantExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = readerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([size]) => { if (size) setCompact(size.contentRect.width < 760) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const submit = useCallback((text: string): void => {
    patchPaperAssistant(sourceKey, { layout: 'assistant' })
    setAssistantExpanded(true)
    if (onSubmitPrompt) onSubmitPrompt(text)
    else void openPaperSpaceAssistant({ workspaceRoot, unitDir, title: entry.meta.title, prompt: text })
  }, [onSubmitPrompt, sourceKey, workspaceRoot, unitDir, entry.meta.title])
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
    patchPaperAssistant(sourceKey, { layout: preset })
    setAssistantExpanded(preset === 'assistant')
  }, [sourceKey])
  const quote = useCallback((selection: PendingPaperSelection): string => {
    const source = entry.meta.pdfFile ? writeJoinPath(unitDir, entry.meta.pdfFile) : ''
    const path = source.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')
    const label = t('paperSpaceSelectionPage', { page: selection.page })
    const reference = path ? `[${label}](${path}#page=${selection.page})` : label
    return `${reference}\n> ${selection.text.replace(/\n/g, '\n> ')}`
  }, [t, entry.meta.pdfFile, unitDir])
  const host = useMemo<PaperReaderHost>(() => ({
    entry,
    onShowInfo: () => setInfoOpen(true),
    layoutPreset,
    applyLayout,
    onBack: () => { void leave() },
    onSubmitPrompt: submit,
    // Quoting stages a draft; it is not permission to send a model request.
    onQuoteSelection: (selection) => { quoteForPaperAssistant(sourceKey, quote(selection)); setAssistantExpanded(true) },
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
    onAttachImage: async (image) => {
      patchPaperAssistant(sourceKey, { images: [...paperAssistantSession(sourceKey).images, image] })
      applyLayout('assistant')
      return true
    }
  }), [entry, applyLayout, layoutPreset, leave, submit, quote, sourceKey, unitDir, workspaceRoot])

  const shownPdf = pdf?.key === sourceKey ? pdf : null
  const showNotes = !pdfPath || layoutPreset === 'notes'
  const showAssistant = layoutPreset === 'assistant' && (!compact || assistantExpanded)
  const readerHeader = <header className="papers-reader-header">
    <button type="button" className="papers-text-button" onClick={() => void leave()}><ArrowLeft size={15} />{t('workSidebarLibrary')}</button>
    <h2 title={entry.meta.title}>{entry.meta.title}</h2>
    <button type="button" className="papers-text-button" onClick={() => applyLayout('notes')}>{t('paperSpaceNotes')}</button>
    <button type="button" className="papers-text-button" aria-expanded={showAssistant}
      onClick={() => applyLayout(showAssistant ? 'read' : 'assistant')}><PanelRightOpen size={16} />{t('paperSpaceAssistant')}</button>
  </header>
  return <PaperReaderHostContext.Provider value={host}>
    <div ref={readerRef} className="papers-reader" data-compact={compact}>
      {readerHeader}
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
        {showAssistant ? <PapersAssistantPanel workspaceRoot={workspaceRoot} unitDir={unitDir} title={entry.meta.title}
          pdfPath={shownPdf?.filePath} expanded={assistantExpanded} onCollapse={() => applyLayout('read')} /> : null}
      </div>
      {infoOpen ? <PaperMetaEditDialog entry={entry} libraryRoot={workspaceRoot} onClose={() => { setInfoOpen(false); void refreshPaperSpace() }} /> : null}
    </div>
  </PaperReaderHostContext.Provider>
}
