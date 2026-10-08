import { useMemo, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FilePlus2, FolderPlus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import { readWriteThreadRegistry } from '../../write/write-thread-registry'
import {
  writeActivityForThreadIds,
  writeDirectoryActivity,
  writeFileActivity,
  type WriteResourceActivityContext
} from '../../write/write-resource-activity'
import { addPdfToPaperLibrary } from '../../paper/paper-library-actions'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import { WriteFileTree } from './WriteFileTree'
import { WorkWhiteboardSidebarSection } from './WorkWhiteboardSidebarSection'
import { WorkSidebarSection } from './WorkSidebarSection'
import type { WorkDirectoryActions } from './use-work-directory-actions'

/**
 * 文件: the current space's whiteboards and file tree. Opening anything here
 * adds it as context to the current session; it never switches the session.
 * The papers folder is shown by 论文 instead, as papers rather than folders.
 */
export function WorkFilesSection({ actions }: { actions: WorkDirectoryActions }): ReactElement {
  const { t } = useTranslation('common')
  const activityContext = useChatStore(useShallow((s): WriteResourceActivityContext => ({
    threads: s.threads,
    activeThreadId: s.activeThreadId,
    busy: s.busy,
    watchTurnCompletion: s.watchTurnCompletion,
    awaitingUserInputThreadIds: s.awaitingUserInputThreadIds,
    unreadThreadIds: s.unreadThreadIds
  })))
  const [whiteboardsExpanded, setWhiteboardsExpanded] = useState(true)
  const [whiteboardMenuId, setWhiteboardMenuId] = useState<string | null>(null)
  const {
    workspaceRoot, entriesByDir, expandedDirs, loadingDirs, treeError, activeFilePath,
    activeWhiteboardId, whiteboards, papersDir, toggleDirectory, openFile, refreshWorkspace, openWhiteboard
  } = useWriteWorkspaceStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    entriesByDir: s.entriesByDir,
    expandedDirs: s.expandedDirs,
    loadingDirs: s.loadingDirs,
    treeError: s.treeError,
    activeFilePath: s.activeFilePath,
    activeWhiteboardId: s.activeWhiteboardId,
    whiteboards: s.whiteboards,
    papersDir: s.paperReading.papersDir,
    toggleDirectory: s.toggleDirectory,
    openFile: s.openFile,
    refreshWorkspace: s.refreshWorkspace,
    openWhiteboard: s.openWhiteboard
  })))
  const { root } = actions
  const writeRegistry = readWriteThreadRegistry()
  const rootLoading = Boolean(loadingDirs.__root__ || loadingDirs[root] || (workspaceRoot.trim() && !entriesByDir[root]))
  const papersFolder = (papersDir || 'papers').replace(/^\/+|\/+$/g, '')
  // Papers live in the 论文 section; their unit folders would only add noise here.
  const visibleEntries = useMemo(() => {
    const rootEntries = entriesByDir[root]
    if (!rootEntries) return entriesByDir
    return {
      ...entriesByDir,
      [root]: rootEntries.filter((entry) => !(entry.type === 'directory' && entry.name === papersFolder))
    }
  }, [entriesByDir, papersFolder, root])
  const activityLabels = {
    runningLabel: t('sidebarThreadRunning'),
    failedLabel: t('sidebarThreadFailed'),
    unreadLabel: t('sidebarThreadUnread'),
    awaitingInputLabel: t('sidebarThreadAwaitingInput')
  }

  const sectionActions = (
    <>
      <SidebarIconButton onClick={() => void actions.openCreateFileDialog(root)} title={t('writeCreateFile')}
        ariaLabel={t('writeCreateFile')} className="h-6 w-6">
        <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </SidebarIconButton>
      <SidebarIconButton onClick={() => void actions.openCreateDirectoryDialog(root)} title={t('writeCreateFolder')}
        ariaLabel={t('writeCreateFolder')} className="h-6 w-6">
        <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </SidebarIconButton>
      <SidebarIconButton onClick={() => void refreshWorkspace(workspaceRoot)} title={t('writeRefreshWorkspace')}
        ariaLabel={t('writeRefreshWorkspace')} className="h-6 w-6">
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
      </SidebarIconButton>
    </>
  )

  return (
    <WorkSidebarSection id="files" label={t('workSidebarViewFiles')} actions={sectionActions}>
      <div className="work-directory flex flex-col" data-work-directory>
        {actions.revealError ? (
          <div className="mx-1 mb-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {actions.revealError}
          </div>
        ) : null}
        <WorkWhiteboardSidebarSection
          whiteboards={Object.values(whiteboards)}
          activeWhiteboardId={activeWhiteboardId}
          expanded={whiteboardsExpanded}
          openMenuId={whiteboardMenuId}
          label={t('writeWhiteboards', { defaultValue: 'Whiteboards' })}
          createLabel={t('writeCreateWhiteboard', { defaultValue: 'New whiteboard' })}
          moreActionsLabel={t('writeMoreActions')}
          renameLabel={t('writeRenameEntry')}
          deleteLabel={t('writeEntryDialogDelete')}
          {...activityLabels}
          activityForBoard={(board) => writeActivityForThreadIds(workWhiteboardThreadIds(board), activityContext).activity}
          onToggle={() => setWhiteboardsExpanded((value) => !value)}
          onCreate={() => void actions.openNewWhiteboard()}
          onOpen={openWhiteboard}
          onToggleMenu={(boardId) => setWhiteboardMenuId((current) => current === boardId ? null : boardId)}
          onRename={(board) => {
            setWhiteboardMenuId(null)
            actions.setEntryDialog({ kind: 'rename-whiteboard', board, value: board.title })
          }}
          onDelete={(board) => {
            setWhiteboardMenuId(null)
            actions.setEntryDialog({ kind: 'delete-whiteboard', board })
          }}
        />
        <WriteFileTree
          rootDirectory={root}
          dragReferenceRoot={workspaceRoot}
          entriesByDir={visibleEntries}
          expandedDirs={expandedDirs}
          loadingDirs={loadingDirs}
          selectedFilePath={activeFilePath}
          error={treeError}
          rootLoading={rootLoading}
          onToggleDir={(path) => void toggleDirectory(workspaceRoot, path)}
          onSelectFile={(path) => void openFile(workspaceRoot, path)}
          onCreateFile={(directoryPath) => void actions.openCreateFileDialog(directoryPath)}
          onCreateDirectory={(directoryPath) => void actions.openCreateDirectoryDialog(directoryPath)}
          onRenameEntry={actions.openRenameEntryDialog}
          onDeleteEntry={actions.openDeleteEntryDialog}
          onRevealEntry={(entry) => void actions.revealWritePath(entry.path, workspaceRoot)}
          onOpenPdfAsPaper={(entry) => void addPdfToPaperLibrary({ pdfPath: entry.path, t })}
          openPdfAsPaperTitle={t('writePaperAddToLibrary')}
          onRefresh={() => void refreshWorkspace(workspaceRoot)}
          showHeader={false}
          showRootLabel={false}
          embedded
          activityForPath={(path, isDirectory) => (
            isDirectory
              ? writeDirectoryActivity(workspaceRoot, path, activityContext, writeRegistry).activity
              : writeFileActivity(workspaceRoot, path, activityContext, writeRegistry).activity
          )}
        />
      </div>
    </WorkSidebarSection>
  )
}
