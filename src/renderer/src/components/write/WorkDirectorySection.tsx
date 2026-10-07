import { useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderOpen, FolderPlus, FolderSearch, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { confirmDialog } from '../../lib/confirm-dialog'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import { readWriteThreadRegistry } from '../../write/write-thread-registry'
import { mountWorkSpace } from '../../write/work-session-actions'
import {
  writeActivityForThreadIds,
  writeDirectoryActivity,
  writeFileActivity,
  writeWorkspaceActivity,
  type WriteResourceActivityContext
} from '../../write/write-resource-activity'
import { addPdfToPaperLibrary } from '../../paper/paper-library-actions'
import { SidebarIconButton, SidebarTreeRow } from '../sidebar/SidebarPrimitives'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { PaperWorkspacesSection } from '../paper/sidebar/PaperWorkspacesSection'
import { WriteFileTree } from './WriteFileTree'
import { WorkWhiteboardSidebarSection } from './WorkWhiteboardSidebarSection'
import type { WorkDirectoryActions } from './use-work-directory-actions'

/**
 * 目录 view: every work space (whiteboards + file tree of the mounted one),
 * then the paper libraries. Picking either mounts it; row actions appear on
 * hover so names keep the full width.
 */
export function WorkDirectorySection({ actions, showLibraries }: {
  actions: WorkDirectoryActions
  showLibraries: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const activityContext = useChatStore(useShallow((s): WriteResourceActivityContext => ({
    threads: s.threads,
    activeThreadId: s.activeThreadId,
    busy: s.busy,
    watchTurnCompletion: s.watchTurnCompletion,
    awaitingUserInputThreadIds: s.awaitingUserInputThreadIds,
    unreadThreadIds: s.unreadThreadIds
  })))
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({})
  const [collapsedWhiteboardFolders, setCollapsedWhiteboardFolders] = useState<Record<string, boolean>>({})
  const [whiteboardMenuId, setWhiteboardMenuId] = useState<string | null>(null)
  const {
    defaultWorkspaceRoot, workspaceRoots, settingsError, workspaceRoot, workSurface, entriesByDir,
    expandedDirs, loadingDirs, treeError, activeFilePath, activeWhiteboardId, whiteboards,
    removeWriteWorkspace, toggleDirectory, openFile, refreshWorkspace, openWhiteboard
  } = useWriteWorkspaceStore(useShallow((s) => ({
    defaultWorkspaceRoot: s.defaultWorkspaceRoot,
    workspaceRoots: s.workspaceRoots,
    settingsError: s.settingsError,
    workspaceRoot: s.workspaceRoot,
    workSurface: s.workSurface,
    entriesByDir: s.entriesByDir,
    expandedDirs: s.expandedDirs,
    loadingDirs: s.loadingDirs,
    treeError: s.treeError,
    activeFilePath: s.activeFilePath,
    activeWhiteboardId: s.activeWhiteboardId,
    whiteboards: s.whiteboards,
    removeWriteWorkspace: s.removeWriteWorkspace,
    toggleDirectory: s.toggleDirectory,
    openFile: s.openFile,
    refreshWorkspace: s.refreshWorkspace,
    openWhiteboard: s.openWhiteboard
  })))
  const { root } = actions
  const writeRegistry = readWriteThreadRegistry()
  const activityLabels = {
    runningLabel: t('sidebarThreadRunning'),
    failedLabel: t('sidebarThreadFailed'),
    unreadLabel: t('sidebarThreadUnread'),
    awaitingInputLabel: t('sidebarThreadAwaitingInput')
  }
  const rootLoading = Boolean(loadingDirs.__root__ || loadingDirs[root] || (workspaceRoot.trim() && !entriesByDir[root]))
  const revealLabel = window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager')

  const toggleWorkspaceGroup = async (workspacePath: string, mounted: boolean): Promise<void> => {
    if (!mounted) {
      if (await mountWorkSpace(workspacePath)) {
        setCollapsedWorkspaces((current) => ({ ...current, [workspacePath]: false }))
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(workspacePath)
      }
      return
    }
    setCollapsedWorkspaces((current) => ({ ...current, [workspacePath]: current[workspacePath] !== true }))
  }

  const removeWorkspaceFromList = async (workspacePath: string): Promise<void> => {
    if (workspaceRoots.length <= 1) return
    if (!(await confirmDialog(t('writeRemoveWorkspaceConfirm', { name: writeBasenameFromPath(workspacePath) })))) return
    await removeWriteWorkspace(workspacePath)
  }

  return (
    <div className="work-directory flex flex-col" data-work-directory>
      <div className="work-sidebar-label">
        <span>{t('writeSpaces')}</span>
        <SidebarIconButton onClick={() => void actions.pickWriteWorkspace()} title={t('writeAddWorkspace')}
          ariaLabel={t('writeAddWorkspace')} className="h-6 w-6">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </SidebarIconButton>
      </div>
      {settingsError || actions.revealError ? (
        <div className="mx-1 mb-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {settingsError ?? actions.revealError}
        </div>
      ) : null}
      {workspaceRoots.map((workspacePath) => {
        const mounted = workSurface === 'docs' && workspacePath === workspaceRoot
        const collapsed = mounted ? collapsedWorkspaces[workspacePath] === true : true
        const removable = workspaceRoots.length > 1 && workspacePath !== defaultWorkspaceRoot
        const name = workspacePath === defaultWorkspaceRoot ? t('writeDefaultSpace') : writeBasenameFromPath(workspacePath)
        return (
          <div key={workspacePath} className="mb-0.5">
            <SidebarTreeRow
              active={mounted}
              title={workspacePath}
              onClick={() => void toggleWorkspaceGroup(workspacePath, mounted)}
              className="min-h-[30px]"
              buttonClassName="items-center gap-1.5 px-1.5 py-1.5"
              actionsVisibility="hidden"
              actionsLayout="overlay"
              trailing={(
                <SidebarActivityIndicator
                  activity={writeWorkspaceActivity(workspacePath, activityContext, writeRegistry).activity}
                  {...activityLabels}
                />
              )}
              actions={(
                <>
                  <SidebarIconButton onClick={() => void actions.revealWritePath(workspacePath, workspacePath)}
                    title={revealLabel} ariaLabel={revealLabel} stopPropagation className="h-6 w-6">
                    <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </SidebarIconButton>
                  {mounted ? (
                    <>
                      <SidebarIconButton onClick={() => void actions.openCreateFileDialog(root)} title={t('writeCreateFile')}
                        ariaLabel={t('writeCreateFile')} stopPropagation className="h-6 w-6">
                        <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </SidebarIconButton>
                      <SidebarIconButton onClick={() => void actions.openCreateDirectoryDialog(root)} title={t('writeCreateFolder')}
                        ariaLabel={t('writeCreateFolder')} stopPropagation className="h-6 w-6">
                        <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </SidebarIconButton>
                      <SidebarIconButton onClick={() => void refreshWorkspace(workspaceRoot)} title={t('writeRefreshWorkspace')}
                        ariaLabel={t('writeRefreshWorkspace')} stopPropagation className="h-6 w-6">
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </SidebarIconButton>
                    </>
                  ) : null}
                  {removable ? (
                    <SidebarIconButton onClick={() => void removeWorkspaceFromList(workspacePath)} title={t('writeRemoveWorkspace')}
                      ariaLabel={t('writeRemoveWorkspace')} tone="danger" stopPropagation className="h-6 w-6">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                  ) : null}
                </>
              )}
            >
              {collapsed
                ? <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                : <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
              {collapsed
                ? <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                : <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${mounted ? 'text-accent' : 'text-ds-muted'}`} strokeWidth={1.75} />}
              <span className={`min-w-0 flex-1 truncate ${mounted ? 'font-medium text-ds-ink' : ''}`}>{name}</span>
            </SidebarTreeRow>

            {mounted && !collapsed ? (
              <div className="pl-2.5">
                <WorkWhiteboardSidebarSection
                  whiteboards={Object.values(whiteboards)}
                  activeWhiteboardId={activeWhiteboardId}
                  expanded={collapsedWhiteboardFolders[workspacePath] !== true}
                  openMenuId={whiteboardMenuId}
                  label={t('writeWhiteboards', { defaultValue: 'Whiteboards' })}
                  createLabel={t('writeCreateWhiteboard', { defaultValue: 'New whiteboard' })}
                  moreActionsLabel={t('writeMoreActions')}
                  renameLabel={t('writeRenameEntry')}
                  deleteLabel={t('writeEntryDialogDelete')}
                  {...activityLabels}
                  activityForBoard={(board) => writeActivityForThreadIds(workWhiteboardThreadIds(board), activityContext).activity}
                  onToggle={() => setCollapsedWhiteboardFolders((current) => ({
                    ...current,
                    [workspacePath]: current[workspacePath] !== true
                  }))}
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
                  entriesByDir={entriesByDir}
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
            ) : null}
          </div>
        )
      })}
      {showLibraries ? <PaperWorkspacesSection variant="embedded" /> : null}
    </div>
  )
}
