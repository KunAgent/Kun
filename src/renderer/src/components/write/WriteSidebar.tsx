import type { FormEvent, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  RefreshCw,
  Settings,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeDirnameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { WriteFileTree } from './WriteFileTree'

type Props = {
  activeView: 'chat' | 'write' | 'claw'
  onCodeOpen: () => void
  onWriteOpen: () => void
  onClawOpen: () => void
  onOpenSettings: (section?: SettingsRouteSection) => void
}

type EntryDialog =
  | { kind: 'create-file'; parentDirectory?: string; value: string }
  | { kind: 'create-folder'; parentDirectory?: string; value: string }
  | { kind: 'rename'; entry: WorkspaceEntry; value: string }
  | { kind: 'delete'; entry: WorkspaceEntry }

type Translate = (key: string, opts?: Record<string, unknown>) => string

export function WriteSidebar({
  activeView,
  onCodeOpen,
  onWriteOpen,
  onClawOpen,
  onOpenSettings
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const [appVersion, setAppVersion] = useState('')
  const [entryDialog, setEntryDialog] = useState<EntryDialog | null>(null)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({})
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
    refreshWorkspace
  } = useWriteWorkspaceStore()

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.getAppVersion !== 'function') return
    void window.dsGui.getAppVersion().then((version) => {
      if (!cancelled) setAppVersion(version)
    }).catch(() => {
      if (!cancelled) setAppVersion('')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  const root = rootDirectory || workspaceRoot
  const rootLoading = Boolean(
    loadingDirs.__root__
    || loadingDirs[root]
    || (workspaceRoot.trim() && !entriesByDir[root])
  )

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

    if (entryDialog.kind === 'delete') {
      const ok = await deleteEntry(workspaceRoot, entryDialog.entry.path)
      if (ok) setEntryDialog(null)
      return
    }

    const value = entryDialog.value.trim()
    if (!value) return

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
    if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') return
    const picked = await window.dsGui.pickWorkspaceDirectory(workspaceRoot || defaultWorkspaceRoot || undefined)
    if (!picked.canceled && picked.path) {
      await addWriteWorkspace(picked.path)
      void ensureWriteThreadForWorkspace(picked.path)
    }
  }

  const selectWorkspaceAndThread = async (workspacePath: string): Promise<void> => {
    await selectWriteWorkspace(workspacePath)
    void ensureWriteThreadForWorkspace(workspacePath)
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
    if (!window.confirm(t('writeRemoveWorkspaceConfirm', { name: writeBasenameFromPath(workspacePath) }))) return
    await removeWriteWorkspace(workspacePath)
  }

  return (
    <>
    <aside className="ds-drag ds-sidebar-shell ds-frosted relative flex h-full w-full shrink-0 flex-col px-3 pb-3">
      <div className="shrink-0 px-1 pb-2 pt-3">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <div className="flex min-h-8 items-center justify-center px-1 pt-1">
          <div className="truncate text-center text-[17px] font-medium tracking-[-0.025em] text-ds-ink">
            {t('appName')}
          </div>
        </div>
        <div className="mx-1 mt-4 border-t border-ds-border-muted/20" />
      </div>

      <div className="ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
          onClawOpen={onClawOpen}
        />
        <WriteSidebarLink
          icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.9} />}
          label={t('writeCreateFile')}
          onClick={() => void openCreateFileDialog()}
          variant="flat-accent"
        />
        <WriteSidebarLink
          icon={<FolderOpen className="h-4 w-4" strokeWidth={1.75} />}
          label={t('writeAddWorkspace')}
          onClick={() => void pickWriteWorkspace()}
        />
      </div>

      <div className="ds-no-drag mx-1 my-3" />

      <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
            {t('writeSpaces')}
          </span>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void pickWriteWorkspace()}
            className="ds-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover/70 hover:text-ds-ink"
            title={t('writeAddWorkspace')}
            aria-label={t('writeAddWorkspace')}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {settingsError ? (
          <div className="mx-2 mt-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {settingsError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-1">
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
            return (
              <div key={workspacePath} className="mb-1">
                <div
                  className={`group relative flex w-full items-center gap-0.5 overflow-hidden rounded-[10px] text-[14px] font-medium transition ${
                    active
                      ? 'bg-black/8 text-ds-ink dark:bg-white/[0.055]'
                      : 'text-ds-ink hover:bg-ds-hover/45'
                  }`}
                  title={workspacePath}
                >
                  <span
                    aria-hidden
                    className={`absolute bottom-1 left-0 top-1 w-[2px] rounded-full transition ${
                      active ? 'bg-accent opacity-100' : 'bg-transparent opacity-0'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => void toggleWorkspaceGroup(workspacePath)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 pl-3 text-left"
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
                  </button>

                  {active ? (
                    <>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void openCreateFileDialog(root)
                        }}
                        className="ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-55 transition hover:bg-accent/10 hover:text-accent hover:opacity-100 group-hover:opacity-100"
                        title={t('writeCreateFile')}
                        aria-label={t('writeCreateFile')}
                      >
                        <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void openCreateDirectoryDialog(root)
                        }}
                        className="ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-55 transition hover:bg-ds-hover/80 hover:text-ds-ink hover:opacity-100 group-hover:opacity-100"
                        title={t('writeCreateFolder')}
                        aria-label={t('writeCreateFolder')}
                      >
                        <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void refreshWorkspace(workspaceRoot)
                        }}
                        className="ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-55 transition hover:bg-ds-hover/80 hover:text-ds-ink hover:opacity-100 group-hover:opacity-100"
                        title={t('writeRefreshWorkspace')}
                        aria-label={t('writeRefreshWorkspace')}
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </>
                  ) : null}

                  {workspaceRoots.length > 1 && workspacePath !== defaultWorkspaceRoot ? (
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        void removeWorkspaceFromList(workspacePath)
                      }}
                      className="ds-no-drag mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-45 transition hover:bg-red-500/10 hover:text-red-600 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:text-red-300"
                      title={t('writeRemoveWorkspace')}
                      aria-label={t('writeRemoveWorkspace')}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>

                {active && !collapsed ? (
                  <div className="mt-0.5 pl-2">
                    <div className="px-2 pb-1 text-[11.5px] text-ds-faint">
                      <span className="block truncate" title={workspacePath}>
                        {workspacePath === defaultWorkspaceRoot ? t('writeDefaultSpace') : workspacePath}
                      </span>
                    </div>
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

      <div className="ds-no-drag mt-2 border-t border-ds-border-muted/20 px-1 pt-3">
        <button
          type="button"
          onClick={() => onOpenSettings('write')}
          className="flex min-h-[38px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-[14px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <span className="inline-flex items-center gap-3">
            <Settings className="h-4 w-4" strokeWidth={1.75} />
            {t('settings')}
          </span>
          {appVersion ? <span className="text-[12px] text-ds-faint">v{appVersion}</span> : null}
        </button>
      </div>
    </aside>
    {entryDialog ? (
      <WriteEntryDialog
        dialog={entryDialog}
        onClose={() => setEntryDialog(null)}
        onValueChange={(value) =>
          setEntryDialog((current) => {
            if (!current || current.kind === 'delete') return current
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

function entryDialogTitle(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'create-file') return t('writeCreateFile')
  if (dialog.kind === 'create-folder') return t('writeCreateFolder')
  if (dialog.kind === 'rename') return t('writeRenameEntry')
  return dialog.entry.type === 'directory' ? t('writeDeleteFolder') : t('writeDeleteFile')
}

function entryDialogSubmitLabel(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'rename') return t('writeEntryDialogRename')
  if (dialog.kind === 'delete') return t('writeEntryDialogDelete')
  return t('writeEntryDialogCreate')
}

function entryDialogDescription(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'delete') {
    return dialog.entry.type === 'directory'
      ? t('writeDeleteFolderConfirm', { name: dialog.entry.name })
      : t('writeDeleteFileConfirm', { name: dialog.entry.name })
  }
  if (dialog.kind === 'rename') return t('writeRenameEntryPrompt')
  if (dialog.kind === 'create-file') return t('writeCreateFilePrompt')
  return t('writeCreateFolderPrompt')
}

function WriteEntryDialog({
  dialog,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  dialog: EntryDialog
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: Translate
}): ReactElement {
  const deleting = dialog.kind === 'delete'
  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
          {entryDialogTitle(dialog, t)}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {entryDialogDescription(dialog, t)}
        </p>
        {!deleting ? (
          <input
            autoFocus
            value={dialog.value}
            onChange={(event) => onValueChange(event.target.value)}
            className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('writeEntryDialogCancel')}
          </button>
          <button
            type="submit"
            className={`rounded-xl px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 ${
              deleting ? 'bg-red-500' : 'bg-accent'
            }`}
          >
            {entryDialogSubmitLabel(dialog, t)}
          </button>
        </div>
      </form>
    </div>
  )
}

type WriteSidebarActionProps = {
  icon: ReactElement
  label: string
  onClick: () => void
  variant?: 'flat' | 'flat-accent'
}

function WriteSidebarLink({
  icon,
  label,
  onClick,
  variant = 'flat'
}: WriteSidebarActionProps): ReactElement {
  const isAccent = variant === 'flat-accent'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-medium transition ${
        isAccent
          ? 'border border-ds-border-muted/30 bg-white/[0.02] text-ds-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-white/[0.035] dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
          : 'text-ds-muted hover:bg-ds-hover/45 hover:text-ds-ink'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${
          isAccent ? 'text-accent' : 'text-ds-muted'
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  )
}
