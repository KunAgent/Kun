import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { WriteEditorGroupContent } from '../../components/write/WriteEditorGroupContent'
import { MobileWorkResource } from './MobileWorkResource'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import type { WorkResourceView } from '../navigation/mobile-page'

export function MobileWorkResourceScreen({ resourceKey, view, onBack, onView }: {
  resourceKey: string
  view: WorkResourceView
  onBack: () => void
  onView: (view: WorkResourceView) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const work = useWriteWorkspaceStore()
  const entries = Object.values(work.entriesByDir).flat()
  const file = entries.find((entry) => entry.type === 'file'
    && workFileResourceKey(work.workspaceRoot, entry.path) === resourceKey)
  const board = Object.values(work.whiteboards).find((item) =>
    workWhiteboardResourceKey(item.id) === resourceKey)
  const document = file ? work.documentsByPath[file.path] : undefined

  useEffect(() => {
    if (file && !document) void work.openFile(work.workspaceRoot, file.path)
    if (board && work.activeWhiteboardId !== board.id) work.openWhiteboard(board.id)
  }, [board, document, file, work])

  if (!file && !board) {
    return <section className="kun-mobile-unavailable" role="alert">
      <p>{t('writeFileNotFound')}</p><button type="button" onClick={onBack}>{t('back')}</button>
    </section>
  }

  const title = board?.title ?? file?.name ?? resourceKey
  const status = board ? board.phase : document?.saveStatus ?? (work.fileLoading ? 'loading' : 'saved')
  const viewMode = view === 'edit' ? 'source' : 'preview'
  const supportedViews: WorkResourceView[] = board
    ? ['whiteboard', 'assistant']
    : ['read', 'edit', 'assistant', ...(document?.pendingAgentReview ? ['review' as const] : [])]

  return <MobileWorkResource title={title} statusLabel={status} view={view}
    labels={{ read: t('preview'), edit: t('edit'), assistant: t('writeAssistantTitle'),
      review: t('review'), whiteboard: t('whiteboard'), back: t('back'), more: t('more') }}
    supportedViews={supportedViews} onBack={onBack} onMenu={() => undefined} onView={onView}
    content={view === 'assistant' || view === 'review'
      ? <p className="kun-mobile-unavailable">{t('loading')}</p>
      : <WriteEditorGroupContent
          document={document} whiteboard={board} requestedPath={file?.path ?? null}
          viewMode={viewMode} workspaceRoot={work.workspaceRoot}
          workspaceName={work.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? work.workspaceRoot}
          workspacePathLabel={work.workspaceRoot} workspaceError={work.settingsError ?? work.treeError}
          inlineCompletion={work.inlineCompletion} inlineCompletionApiReady={work.inlineCompletionApiReady}
          recentEdits={document?.recentEdits ?? []} focused focusMode={false}
          onFocusModeChange={() => undefined} onFocus={() => undefined}
          onAskAssistant={() => onView('assistant')} onCreateDraft={() => undefined}
          onPickWorkspace={() => undefined} onRefreshWorkspace={() => void work.refreshWorkspace(work.workspaceRoot)}
          onContentChange={(content) => { if (file) work.setDocumentContent(file.path, content) }}
          onDocumentEdit={work.recordRecentEdits} onSelectionChange={work.setSelection}
          onSaveShortcut={() => { if (file) void work.saveDocument(work.workspaceRoot, file.path) }}
          onImagePasteSaved={() => undefined} onImagePasteError={work.setFileError}
          onPresentationViewChange={(next) => {
            if (next) work.setPresentationViewForGroup('primary', next)
          }}
          onReviewStateChange={work.setReviewActive}
          onSpreadsheetMutations={work.setSpreadsheetMutations}
          onConvertSpreadsheet={(path) => { void work.convertSpreadsheet(work.workspaceRoot, path) }}
          onReloadSpreadsheetConflict={work.reloadSpreadsheetConflict}
          onResolveSpreadsheetConflict={work.resolveSpreadsheetConflict}
        />}
  />
}
