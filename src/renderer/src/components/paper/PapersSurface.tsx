import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { LibraryBig, LockKeyhole, PanelLeft, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperSpaceStore } from '../../paper/paper-space-store'
import { refreshPaperSpace } from '../../paper/paper-space'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { openPaperSpaceAssistant } from '../../paper/paper-space-assistant'
import { usePaperImportSession } from '../../paper/paper-import-session'
import { useChatStore } from '../../store/chat-store'
import { usePaperBatchInterpret } from '../../paper/paper-batch-interpret'
import { PapersLibraryView } from './PapersLibraryView'
import { PaperImportDialogHost } from './PaperImportDialogHost'
import { PaperBatchInterpretDialogHost } from './batch/PaperBatchInterpretDialog'
import { PaperNoticeToast } from './PaperNoticeToast'
import './papers-space.css'

const PapersReader = lazy(() => import('./PapersReader').then((module) => ({ default: module.PapersReader })))
const PaperSearchView = lazy(() => import('./discover/PaperSearchView').then((module) => ({ default: module.PaperSearchView })))
const PaperDiscoverView = lazy(() => import('./PaperDiscoverView').then((module) => ({ default: module.PaperDiscoverView })))

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onSubmitPrompt?: (prompt: string) => void
  onAttachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
}

/** A global paper destination, independent of the document workspace and its tabs. */
export function PapersSurface({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const state = usePaperSpaceStore()
  const legacyPaperReading = useWriteWorkspaceStore((write) => write.paperReading)
  const paperReading = state.paperReading ?? legacyPaperReading
  const rootsKey = useWriteWorkspaceStore((write) => write.workspaceRoots.join('\0'))
  const refreshToken = usePaperModeStore((mode) => mode.entriesRefreshToken)
  const importSession = usePaperImportSession()
  const batch = usePaperBatchInterpret((store) => store.job)
  const reader = state.readerKey ? state.items.find((item) => item.key === state.readerKey) : null
  const discoverSource = state.view === 'discover:arxiv' ? 'arxiv' : state.view === 'discover:venue' ? 'venue' : 'feeds'

  useEffect(() => { void refreshPaperSpace() }, [refreshToken, rootsKey])

  const openSession = (_root: string, threadId: string): void => {
    // Opening a result selects the existing thread; it must not mount its source as Work.
    void useChatStore.getState().selectThread(threadId).then(() => {
      if (useChatStore.getState().activeThreadId === threadId) useChatStore.setState({ route: 'chat' })
    })
  }

  return (
    <section className="papers-space ds-no-drag" data-papers-surface>
      <header className="papers-space-topbar">
        <button type="button" className="papers-icon-button" onClick={onToggleLeftSidebar}
          aria-label={t(leftSidebarCollapsed ? 'paperSpaceShowSidebar' : 'paperSpaceHideSidebar')} aria-expanded={!leftSidebarCollapsed}>
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>
        <span className="papers-space-divider" aria-hidden />
        <LibraryBig size={18} strokeWidth={1.75} />
        <span>{t('workSidebarPapersNav')}</span>
        <span className="papers-space-unified"><LockKeyhole size={14} strokeWidth={1.75} />{t('paperSpaceUnified')}</span>
      </header>
      {reader && state.error ? <div className="papers-notes-error" role="alert">{state.error}</div> : null}
      {reader ? (
        <Suspense fallback={<div className="papers-space-loading" aria-busy>{t('loading')}</div>}>
          <PapersReader key={reader.key} workspaceRoot={reader.libraryRoot} entry={reader.entry}
            onBack={() => usePaperSpaceStore.setState({ readerKey: null })}
            onSubmitPrompt={(prompt, images) => { void openPaperSpaceAssistant({ workspaceRoot: reader.libraryRoot,
              unitDir: reader.entry.unitDir, title: reader.entry.meta.title, prompt, images }).catch((error: unknown) => {
                usePaperSpaceStore.setState({ error: error instanceof Error ? error.message : String(error) })
              }) }} />
        </Suspense>
      ) : state.view === 'library' ? <PapersLibraryView /> : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="papers-discover-back"><button type="button" className="papers-text-button" onClick={() => state.setView('library')}>← {t('workSidebarLibrary')}</button></div>
          <Suspense fallback={<div className="papers-space-loading" aria-busy>{t('loading')}</div>}>
            {state.view === 'discover:search' ? <PaperSearchView /> : <PaperDiscoverView source={discoverSource} />}
          </Suspense>
        </div>
      )}
      {batch && !batch.running ? (
        <div className="papers-batch-result" role="status">
          <span>{t('paperBatchFinished', { done: batch.items.filter((item) => item.status === 'done').length,
            skipped: batch.items.filter((item) => item.status === 'skipped').length, failed: batch.items.filter((item) => item.status === 'failed').length })}</span>
          {batch.items.find((item) => item.status === 'done' && item.threadId) ? <button type="button" className="papers-text-button" onClick={() => {
            const first = batch.items.find((item) => item.status === 'done' && item.threadId)
            if (first?.threadId) openSession(first.workspaceRoot ?? batch.workspaceRoot, first.threadId)
          }}>{t('paperBatchOpenFirst')}</button> : null}
          <button type="button" className="papers-icon-button" aria-label={t('close')} onClick={() => usePaperBatchInterpret.getState().dismiss()}><X size={14} /></button>
        </div>
      ) : null}
      {importSession.items.length || importSession.error ? <div className="papers-batch-result" role={importSession.error ? 'alert' : 'status'}>
        <button type="button" className="papers-text-button" onClick={() => usePaperModeStore.getState().setImportDialogOpen(true)}>
          {importSession.error || (importSession.running ? t('paperSpaceImportBackground') : t('paperImportSummary', {
            added: importSession.items.filter((item) => item.status === 'done' && !item.reused).length,
            existing: importSession.items.filter((item) => item.status === 'done' && item.reused).length,
            failed: importSession.items.filter((item) => item.status === 'failed').length }))}
        </button>
      </div> : null}
      <footer className="papers-space-footer"><span>{t('paperSpaceOnDevice')}</span><span>{t('paperSpaceOneSpace')}</span></footer>
      {state.workspaceRoot && state.status === 'ready' ? <PaperImportDialogHost workspaceRoot={state.workspaceRoot} paperReading={paperReading} /> : null}
      <PaperBatchInterpretDialogHost onOpenSession={openSession} />
      <PaperNoticeToast />
    </section>
  )
}
