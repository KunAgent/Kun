import type { FormEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Network,
  Plus,
  RefreshCw,
  Settings,
  Smartphone,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WorkWhiteboard } from '../../write/write-workspace-store'
import { useNodeGraphStore } from '../../node-graph/node-graph-store'
import { confirmDialog } from '../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { revealWorkspacePathInFileManager } from '../../lib/open-workspace-path'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeDirnameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { renameWorkWhiteboardSession } from '../../write/work-whiteboard-session-title'
import { WorkWhiteboardTitleDialog } from './WorkWhiteboardTitleDialog'
import { useWorkWhiteboardCreation } from './use-work-whiteboard-creation'
import { WriteEntryDialog, type WriteEntryDialogKind } from './WriteEntryDialog'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'
import { WriteFileTree } from './WriteFileTree'
import { WorkWhiteboardSidebarSection } from './WorkWhiteboardSidebarSection'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow' | 'nodeGraph'
  connectPhoneSidebarOpen: boolean
  focusModeEnabled: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
}

type Translate = (key: string, opts?: Record<string, unknown>) => string

export function WriteSidebar({
  activeView,
  connectPhoneSidebarOpen,
  focusModeEnabled,
  onCodeOpen,
  onWriteOpen,
  onFocusModeChange,
  onOpenSettings,
  onToggleConnectPhone
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workGraphOpen = useNodeGraphStore((state) => state.workGraphOpen)
  const toggleWorkGraph = useNodeGraphStore((state) => state.toggleWorkGraph)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const renameThread = useChatStore((s) => s.renameThread)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const [entryDialog, setEntryDialog] = useState<WriteEntryDialogKind | null>(null)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({})
  const [collapsedWhiteboardFolders, setCollapsedWhiteboardFolders] = useState<Record<string, boolean>>({})
  const [revealError, setRevealError] = useState<string | null>(null)
  const [whiteboardMenuId, setWhiteboardMenuId] = useState<string | null>(null)
  const revealErrorTimerRef = useRef<number | null>(null)
  // Field-level subscription: the sidebar must not re-render on fileContent or
  // selection updates, which fire on every keystroke in the editor.
  const {
    defaultWorkspaceRoot,
    workspaceRoots,
    settingsError,
    workspaceRoot,
    rootDirectory,
    entriesByDir,
    expandedDirs,
    loadingDirs,
    treeError,
    activeFilePath,
    activeWhiteboardId,
    whiteboards,
    loadWriteSettings,
    selectWriteWorkspace,
    addWriteWorkspace,
    removeWriteWorkspace,
    toggleDirectory,
    openFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshWorkspace,
    setFileError,
    openWhiteboard,
    renameWhiteboard,
    deleteWhiteboard
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      defaultWorkspaceRoot: s.defaultWorkspaceRoot,
      workspaceRoots: s.workspaceRoots,
      settingsError: s.settingsError,
      workspaceRoot: s.workspaceRoot,
      rootDirectory: s.rootDirectory,
      entriesByDir: s.entriesByDir,
      expandedDirs: s.expandedDirs,
      loadingDirs: s.loadingDirs,
      treeError: s.treeError,
      activeFilePath: s.activeFilePath,
      activeWhiteboardId: s.activeWhiteboardId,
      whiteboards: s.whiteboards,
      loadWriteSettings: s.loadWriteSettings,
      selectWriteWorkspace: s.selectWriteWorkspace,
      addWriteWorkspace: s.addWriteWorkspace,
      removeWriteWorkspace: s.removeWriteWorkspace,
      toggleDirectory: s.toggleDirectory,
      openFile: s.openFile,
      createFile: s.createFile,
      createDirectory: s.createDirectory,
      renameEntry: s.renameEntry,
      deleteEntry: s.deleteEntry,
      refreshWorkspace: s.refreshWorkspace,
      setFileError: s.setFileError,
      openWhiteboard: s.openWhiteboard,
      renameWhiteboard: s.renameWhiteboard,
      deleteWhiteboard: s.deleteWhiteboard
    }))
  )

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    setRevealError(null)
    if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    revealErrorTimerRef.current = null
    return () => {
      if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    }
  }, [workspaceRoot])

  const root = rootDirectory || workspaceRoot
  const rootLoading = Boolean(
    loadingDirs.__root__
    || loadingDirs[root]
    || (workspaceRoot.trim() && !entriesByDir[root])
  )

  const revealWritePath = async (targetPath: string, boundaryRoot: string): Promise<void> => {
    const result = await revealWorkspacePathInFileManager(targetPath, boundaryRoot)
    if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    if (result.ok) {
      revealErrorTimerRef.current = null
      setRevealError(null)
      return
    }
    setRevealError(result.message)
    revealErrorTimerRef.current = window.setTimeout(() => {
      revealErrorTimerRef.current = null
      setRevealError(null)
    }, 3_600)
  }

  const defaultParentDirectory = (): string => {
    if (!root) return workspaceRoot
    if (activeFilePath && activeFilePath.startsWith(root)) return writeDirnameFromPath(activeFilePath)
    return root
  }

  const suggestedCreatePath = (
    kind: 'file' | 'folder',
    parentDirectory?: string
  ): { parent: string; suggested: string } => {
    const explicitParent = parentDirectory?.trim()
    const parent = explicitParent || defaultParentDirectory()
    const relativeParent = writeRelativeToWorkspace(root, parent)
    const baseName = kind === 'file' ? 'untitled.md' : 'new-folder'
    const suggested = explicitParent
      ? baseName
      : relativeParent === writeBasenameFromPath(root)
        ? baseName
        : `${relativeParent}/${baseName}`
    return { parent: explicitParent || root, suggested }
  }

  const openCreateFileDialog = async (parentDirectory?: string): Promise<void> => {
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    const { suggested } = suggestedCreatePath('file', parentDirectory)
    setEntryDialog({ kind: 'create-file', parentDirectory, value: suggested })
  }

  const openCreateDirectoryDialog = async (parentDirectory?: string): Promise<void> => {
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    const { suggested } = suggestedCreatePath('folder', parentDirectory)
    setEntryDialog({ kind: 'create-folder', parentDirectory, value: suggested })
  }

  const openRenameEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'rename', entry, value: entry.name })
  }

  const openDeleteEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'delete', entry })
  }

  const submitEntryDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!entryDialog) return

    if (entryDialog.kind === 'delete-whiteboard') {
      const ok = await deleteWhiteboard(entryDialog.board.id)
      if (ok) setEntryDialog(null)
      return
    }

    if (entryDialog.kind === 'delete') {
      const ok = await deleteEntry(workspaceRoot, entryDialog.entry.path)
      if (ok) setEntryDialog(null)
      return
    }

    const value = entryDialog.value.trim()
    if (!value) return

    if (entryDialog.kind === 'rename-whiteboard') {
      if (value === entryDialog.board.title) {
        setEntryDialog(null)
        return
      }
      if (await renameWorkWhiteboardSession({
        board: entryDialog.board,
        title: value,
        renameSession: renameThread,
        readSessionTitle: (threadId) => useChatStore.getState().threads
          .find((thread) => thread.id === threadId)?.title ?? null,
        renameWhiteboard
      })) setEntryDialog(null)
      return
    }

    if (entryDialog.kind === 'rename') {
      if (value === entryDialog.entry.name) {
        setEntryDialog(null)
        return
      }
      const renamed = await renameEntry(workspaceRoot, entryDialog.entry.path, value)
      if (renamed) setEntryDialog(null)
      return
    }

    const { parent } = suggestedCreatePath(
      entryDialog.kind === 'create-file' ? 'file' : 'folder',
      entryDialog.parentDirectory
    )
    const created = entryDialog.kind === 'create-file'
      ? await createFile(workspaceRoot, writeJoinPath(parent, value))
      : await createDirectory(workspaceRoot, writeJoinPath(parent, value))
    if (created) setEntryDialog(null)
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(workspaceRoot || defaultWorkspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const {
    newWhiteboardDialogOpen,
    creatingWhiteboard,
    openNewWhiteboardDialog,
    submitNewWhiteboardTitle,
    closeNewWhiteboardDialog
  } = useWorkWhiteboardCreation({
    workspaceRoot,
    onNeedWorkspace: pickWriteWorkspace
  })

  const createWorkWhiteboard = openNewWhiteboardDialog

  const selectWorkspaceAndThread = async (workspacePath: string): Promise<void> => {
    await selectWriteWorkspace(workspacePath)
    if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(workspacePath)
  }

  const toggleWorkspaceGroup = async (workspacePath: string): Promise<void> => {
    if (workspacePath !== workspaceRoot) {
      await selectWorkspaceAndThread(workspacePath)
      setCollapsedWorkspaces((current) => ({ ...current, [workspacePath]: false }))
      return
    }
    setCollapsedWorkspaces((current) => ({
      ...current,
      [workspacePath]: current[workspacePath] !== true
    }))
  }

  const removeWorkspaceFromList = async (workspacePath: string): Promise<void> => {
    if (workspaceRoots.length <= 1) return
    if (!(await confirmDialog(t('writeRemoveWorkspaceConfirm', { name: writeBasenameFromPath(workspacePath) })))) return
    await removeWriteWorkspace(workspacePath)
  }

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      footer={
        <div className="space-y-1">
          <SidebarFocusModeControl
            enabled={focusModeEnabled}
            onChange={onFocusModeChange}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarCommandRow
                icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
                label={t('settings')}
                onClick={() => onOpenSettings('write')}
                variant="footer"
              />
            </div>
            <SidebarIconButton
              title={t('claw')}
              ariaLabel={t('claw')}
              onClick={onToggleConnectPhone}
              active={connectPhoneSidebarOpen}
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
          </div>
        </div>
      }
    >
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-0.5">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />
        <SidebarCommandRow
          icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.9} />}
          label={t('writeCreateFile')}
          onClick={() => void openCreateFileDialog()}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<FolderOpen className="h-4 w-4" strokeWidth={1.75} />}
          label={t('writeAddWorkspace')}
          onClick={() => void pickWriteWorkspace()}
        />
        <SidebarCommandRow
          icon={<Network className="h-4 w-4" strokeWidth={1.75} />}
          label={workGraphOpen ? t('nodeGraphWorkClose') : t('nodeGraphWorkOpen')}
          onClick={toggleWorkGraph}
          active={workGraphOpen}
        />
      </div>

      <div className="ds-no-drag mx-1.5 my-3" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : (
      <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
        <SidebarSectionHeader
          label={t('writeSpaces')}
          actions={
            <SidebarIconButton
              onClick={() => void pickWriteWorkspace()}
              title={t('writeAddWorkspace')}
              ariaLabel={t('writeAddWorkspace')}
              stopPropagation
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </SidebarIconButton>
          }
        />

        {settingsError ? (
          <div className="mx-2 mt-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {settingsError}
          </div>
        ) : null}
        {revealError ? (
          <div className="mx-2 mt-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {revealError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {workspaceRoots.length === 0 ? (
            <button
              type="button"
              onClick={() => void pickWriteWorkspace()}
              className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                {t('writeAddWorkspace')}
              </span>
            </button>
          ) : null}

          {workspaceRoots.map((workspacePath) => {
            const active = workspacePath === workspaceRoot
            const collapsed = active ? collapsedWorkspaces[workspacePath] === true : true
            const removable = workspaceRoots.length > 1 && workspacePath !== defaultWorkspaceRoot
            return (
              <div key={workspacePath} className="mb-1">
                <SidebarTreeRow
                  active={active}
                  title={workspacePath}
                  onClick={() => void toggleWorkspaceGroup(workspacePath)}
                  className="min-h-[36px]"
                  buttonClassName="items-center gap-2 px-2.5 py-2"
                  actions={(
                    <>
                      <SidebarIconButton
                        onClick={() => void revealWritePath(workspacePath, workspacePath)}
                        title={window.kunGui?.platform === 'darwin'
                          ? t('fileTreeRevealInFinder')
                          : t('fileTreeRevealInFileManager')}
                        ariaLabel={window.kunGui?.platform === 'darwin'
                          ? t('fileTreeRevealInFinder')
                          : t('fileTreeRevealInFileManager')}
                        stopPropagation
                      >
                        <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </SidebarIconButton>
                      {active ? (
                        <>
                          <SidebarIconButton
                            onClick={() => void openCreateFileDialog(root)}
                            title={t('writeCreateFile')}
                            ariaLabel={t('writeCreateFile')}
                            tone="accent"
                            stopPropagation
                          >
                            <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </SidebarIconButton>
                          <SidebarIconButton
                            onClick={() => void openCreateDirectoryDialog(root)}
                            title={t('writeCreateFolder')}
                            ariaLabel={t('writeCreateFolder')}
                            stopPropagation
                          >
                            <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </SidebarIconButton>
                          <SidebarIconButton
                            onClick={() => void refreshWorkspace(workspaceRoot)}
                            title={t('writeRefreshWorkspace')}
                            ariaLabel={t('writeRefreshWorkspace')}
                            stopPropagation
                          >
                            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </SidebarIconButton>
                        </>
                      ) : null}

                      {removable ? (
                        <SidebarIconButton
                          onClick={() => void removeWorkspaceFromList(workspacePath)}
                          title={t('writeRemoveWorkspace')}
                          ariaLabel={t('writeRemoveWorkspace')}
                          tone="danger"
                          stopPropagation
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        </SidebarIconButton>
                      ) : null}
                    </>
                  )}
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  )}
                  {collapsed ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{writeBasenameFromPath(workspacePath)}</span>
                </SidebarTreeRow>

                {active && !collapsed ? (
                  <div className="mt-1 pl-3">
                    <div className="px-2.5 pb-1 text-[11.5px] text-ds-faint">
                      <span className="block truncate" title={workspacePath}>
                        {workspacePath === defaultWorkspaceRoot ? t('writeDefaultSpace') : workspacePath}
                      </span>
                    </div>
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
                      onToggle={() => setCollapsedWhiteboardFolders((current) => ({
                        ...current,
                        [workspacePath]: current[workspacePath] !== true
                      }))}
                      onCreate={() => void createWorkWhiteboard()}
                      onOpen={openWhiteboard}
                      onToggleMenu={(boardId) => setWhiteboardMenuId((current) => current === boardId ? null : boardId)}
                      onRename={(board) => {
                        setWhiteboardMenuId(null)
                        setEntryDialog({ kind: 'rename-whiteboard', board, value: board.title })
                      }}
                      onDelete={(board) => {
                        setWhiteboardMenuId(null)
                        setEntryDialog({ kind: 'delete-whiteboard', board })
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
                      onCreateFile={(directoryPath) => void openCreateFileDialog(directoryPath)}
                      onCreateDirectory={(directoryPath) => void openCreateDirectoryDialog(directoryPath)}
                      onRenameEntry={openRenameEntryDialog}
                      onDeleteEntry={openDeleteEntryDialog}
                      onRevealEntry={(entry) => void revealWritePath(entry.path, workspaceRoot)}
                      onRefresh={() => void refreshWorkspace(workspaceRoot)}
                      showHeader={false}
                      showRootLabel={false}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      )}
    </SidebarFrame>
    {newWhiteboardDialogOpen ? (
      <WorkWhiteboardTitleDialog
        submitting={creatingWhiteboard}
        onSubmit={(title) => { void submitNewWhiteboardTitle(title) }}
        onClose={() => {
          if (!creatingWhiteboard) closeNewWhiteboardDialog()
        }}
      />
    ) : null}
    {entryDialog ? (
      <WriteEntryDialog
        dialog={entryDialog}
        onClose={() => setEntryDialog(null)}
        onValueChange={(value) =>
          setEntryDialog((current) => {
            if (!current || current.kind === 'delete' || current.kind === 'delete-whiteboard') return current
            return { ...current, value }
          })
        }
        onSubmit={(event) => void submitEntryDialog(event)}
        t={t}
      />
    ) : null}
    </>
  )
}
