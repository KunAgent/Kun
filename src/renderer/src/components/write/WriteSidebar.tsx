import type { FormEvent, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useShallow } from 'zustand/react/shallow'
import {
  CheckCircle2,
  Cloud,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LarkDocumentListItem, LarkDocumentStatus } from '@shared/lark-document'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { confirmDialog } from '../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeDirnameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { WriteFileTree } from './WriteFileTree'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule'
  connectPhoneSidebarOpen: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
}

type EntryDialog =
  | { kind: 'create-file'; parentDirectory?: string; value: string }
  | { kind: 'create-folder'; parentDirectory?: string; value: string }
  | { kind: 'rename'; entry: WorkspaceEntry; value: string }
  | { kind: 'delete'; entry: WorkspaceEntry }

type AddWorkspaceDialog =
  | { kind: 'choose' }
  | {
      kind: 'lark'
      query: string
      loading: boolean
      importingId: string | null
      bulkImporting: boolean
      documents: LarkDocumentListItem[]
      importedDocumentKeys: string[]
      selectedDocumentIds: string[]
      message: string | null
      status?: LarkDocumentStatus
      setup: LarkSetupState
    }

type LarkSetupState =
  | { kind: 'idle' }
  | { kind: 'installing' }
  | { kind: 'config-loading' }
  | {
      kind: 'config-qr'
      url: string
      deviceCode: string
      userCode: string
      interval: number
      expireIn: number
      error?: string
    }
  | { kind: 'configuring' }
  | { kind: 'auth-starting' }
  | {
      kind: 'auth-qr'
      verificationUrl: string
      deviceCode: string
      userCode?: string | null
      interval?: number | null
      expireIn?: number | null
      completing: boolean
      error?: string
    }
  | { kind: 'ready'; message: string }

type Translate = (key: string, opts?: Record<string, unknown>) => string

export function WriteSidebar({
  activeView,
  connectPhoneSidebarOpen,
  onCodeOpen,
  onWriteOpen,
  onOpenSettings,
  onToggleConnectPhone
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const [entryDialog, setEntryDialog] = useState<EntryDialog | null>(null)
  const [addWorkspaceDialog, setAddWorkspaceDialog] = useState<AddWorkspaceDialog | null>(null)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({})
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
    listLarkDocuments,
    listImportedLarkDocuments,
    importLarkDocument,
    setFileError
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
      listLarkDocuments: s.listLarkDocuments,
      listImportedLarkDocuments: s.listImportedLarkDocuments,
      importLarkDocument: s.importLarkDocument,
      setFileError: s.setFileError
    }))
  )

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

  const openAddWorkspaceDialog = (): void => {
    setAddWorkspaceDialog({ kind: 'choose' })
  }

  const chooseLocalWorkspace = async (): Promise<void> => {
    setAddWorkspaceDialog(null)
    await pickWriteWorkspace()
  }

  const loadLarkDocuments = async (query = ''): Promise<void> => {
    setAddWorkspaceDialog((current) => ({
      kind: 'lark',
      query,
      loading: true,
      importingId: current?.kind === 'lark' ? current.importingId : null,
      bulkImporting: current?.kind === 'lark' ? current.bulkImporting : false,
      documents: current?.kind === 'lark' ? current.documents : [],
      importedDocumentKeys: current?.kind === 'lark' ? current.importedDocumentKeys : [],
      selectedDocumentIds: current?.kind === 'lark' ? current.selectedDocumentIds : [],
      message: null,
      status: current?.kind === 'lark' ? current.status : undefined,
      setup: current?.kind === 'lark' ? current.setup : { kind: 'idle' }
    }))
    const targetRoot = (workspaceRoot || defaultWorkspaceRoot).trim()
    const [result, importedResult] = await Promise.all([
      listLarkDocuments({ query, wide: true }),
      targetRoot
        ? listImportedLarkDocuments(targetRoot)
        : Promise.resolve({
            ok: true as const,
            source: 'lark' as const,
            status: 'enabled' as const,
            documents: []
          })
    ])
    const importedDocumentKeys = importedResult.ok
      ? importedResult.documents.flatMap((document) => larkImportedDocumentKeys(document))
      : []
    setAddWorkspaceDialog((current) => {
      if (!current || current.kind !== 'lark') return current
      const importedKeys = new Set(importedDocumentKeys)
      const selectableIds = new Set(
        result.documents
          .filter((document) => !isLarkDocumentAlreadyImported(document, importedKeys))
          .map((document) => document.id)
      )
      return {
        ...current,
        loading: false,
        importingId: null,
        bulkImporting: false,
        documents: result.documents,
        importedDocumentKeys,
        selectedDocumentIds: current.selectedDocumentIds.filter((id) => selectableIds.has(id)),
        message: importedResult.ok
          ? result.message ?? null
          : [result.message, importedResult.message].filter(Boolean).join(' '),
        status: result.status,
        setup: result.status === 'enabled' && current.setup.kind !== 'idle'
          ? { kind: 'ready', message: result.message ?? t('writeLarkSetupReady') }
          : current.setup
      }
    })
  }

  const openLarkImportDialog = async (): Promise<void> => {
    await loadLarkDocuments('')
  }

  const setLarkSetupState = (
    setup: LarkSetupState,
    message?: string | null,
    status?: LarkDocumentStatus
  ): void => {
    setAddWorkspaceDialog((current) => current?.kind === 'lark'
      ? {
          ...current,
          setup,
          message: message === undefined ? current.message : message,
          status: status ?? current.status
        }
      : current)
  }

  const installAndConfigureLarkCli = async (): Promise<void> => {
    if (typeof window.kunGui?.installLarkCli !== 'function') {
      setLarkSetupState({ kind: 'idle' }, t('writeLarkSetupUnavailable'), 'error')
      return
    }
    setLarkSetupState({ kind: 'installing' }, t('writeLarkSetupInstalling'), 'disabled')
    const installed = await window.kunGui.installLarkCli()
    if (!installed.ok) {
      setLarkSetupState({ kind: 'idle' }, installed.message, installed.status)
      return
    }
    setLarkSetupState({ kind: 'ready', message: installed.message }, installed.message, 'config_required')
    await startLarkCliConfigQr()
  }

  const startLarkCliConfigQr = async (): Promise<void> => {
    if (
      typeof window.kunGui?.startClawImInstallQr !== 'function' ||
      typeof window.kunGui?.pollClawImInstall !== 'function' ||
      typeof window.kunGui?.configureLarkCli !== 'function'
    ) {
      setLarkSetupState({ kind: 'idle' }, t('writeLarkSetupUnavailable'), 'error')
      return
    }
    setLarkSetupState({ kind: 'config-loading' }, t('writeLarkConfigQrLoading'), 'config_required')
    const result = await window.kunGui.startClawImInstallQr('feishu', { isLark: false })
    if (!result.ok) {
      setLarkSetupState({ kind: 'idle' }, result.message, 'config_required')
      return
    }
    const setup: LarkSetupState = {
      kind: 'config-qr',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      interval: result.interval,
      expireIn: result.expireIn
    }
    setLarkSetupState(setup, t('writeLarkConfigQrReady'), 'config_required')
    void pollLarkCliConfigQr(setup)
  }

  const pollLarkCliConfigQr = async (
    setup: Extract<LarkSetupState, { kind: 'config-qr' }>
  ): Promise<void> => {
    const startedAt = Date.now()
    const intervalMs = Math.max(3, setup.interval) * 1000
    const expireMs = Math.max(60, setup.expireIn) * 1000
    while (Date.now() - startedAt < expireMs) {
      await delay(intervalMs)
      if (typeof window.kunGui?.pollClawImInstall !== 'function') return
      const poll = await window.kunGui.pollClawImInstall('feishu', setup.deviceCode)
      if (!poll.done) {
        if (poll.error) {
          setLarkSetupState({ ...setup, error: poll.error }, poll.error, 'config_required')
          return
        }
        continue
      }
      if (poll.kind !== 'feishu') {
        setLarkSetupState({ ...setup, error: t('writeLarkConfigUnexpectedProvider') }, t('writeLarkConfigUnexpectedProvider'), 'error')
        return
      }
      setLarkSetupState({ kind: 'configuring' }, t('writeLarkConfigApplying'), 'config_required')
      if (typeof window.kunGui?.configureLarkCli !== 'function') return
      const configured = await window.kunGui.configureLarkCli({
        appId: poll.appId,
        appSecret: poll.appSecret,
        domain: poll.domain
      })
      if (!configured.ok) {
        setLarkSetupState({ kind: 'idle' }, configured.message, configured.status)
        return
      }
      setLarkSetupState({ kind: 'ready', message: configured.message }, configured.message, 'auth_required')
      await startLarkDocumentAuthFlow()
      return
    }
    setLarkSetupState({ ...setup, error: t('writeLarkConfigExpired') }, t('writeLarkConfigExpired'), 'config_required')
  }

  const startLarkDocumentAuthFlow = async (): Promise<void> => {
    if (
      typeof window.kunGui?.startLarkDocumentAuth !== 'function' ||
      typeof window.kunGui?.completeLarkDocumentAuth !== 'function'
    ) {
      setLarkSetupState({ kind: 'idle' }, t('writeLarkSetupUnavailable'), 'error')
      return
    }
    setLarkSetupState({ kind: 'auth-starting' }, t('writeLarkAuthStarting'), 'auth_required')
    const result = await window.kunGui.startLarkDocumentAuth()
    if (!result.ok) {
      setLarkSetupState({ kind: 'idle' }, result.message, result.status)
      return
    }
    const setup: LarkSetupState = {
      kind: 'auth-qr',
      verificationUrl: result.verificationUrl,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      interval: result.interval,
      expireIn: result.expireIn,
      completing: true
    }
    setLarkSetupState(setup, result.message, 'auth_required')
    window.setTimeout(() => void completeLarkDocumentAuthFlow(setup), 0)
  }

  const completeLarkDocumentAuthFlow = async (
    setup: Extract<LarkSetupState, { kind: 'auth-qr' }>
  ): Promise<void> => {
    if (typeof window.kunGui?.completeLarkDocumentAuth !== 'function') return
    const result = await window.kunGui.completeLarkDocumentAuth({ deviceCode: setup.deviceCode })
    if (!result.ok) {
      setLarkSetupState({ ...setup, completing: false, error: result.message }, result.message, result.status)
      return
    }
    setLarkSetupState({ kind: 'ready', message: result.message }, result.message, 'enabled')
    const query = addWorkspaceDialog?.kind === 'lark' ? addWorkspaceDialog.query : ''
    await loadLarkDocuments(query)
  }

  const openLarkSetupUrl = async (url: string): Promise<void> => {
    if (typeof window.kunGui?.openExternal === 'function') {
      await window.kunGui.openExternal(url)
    }
  }

  const importFromLarkDocument = async (document: LarkDocumentListItem): Promise<void> => {
    const targetRoot = (workspaceRoot || defaultWorkspaceRoot).trim()
    if (!targetRoot) {
      setAddWorkspaceDialog((current) => current?.kind === 'lark'
        ? { ...current, message: t('writeLarkImportNoWorkspace'), status: 'error' }
        : current)
      return
    }

    setFileError(null)
    setAddWorkspaceDialog((current) => current?.kind === 'lark'
      ? { ...current, importingId: document.id, message: null }
      : current)
    if (targetRoot !== workspaceRoot || !workspaceRoots.includes(targetRoot)) {
      await addWriteWorkspace(targetRoot)
    }
    const result = await importLarkDocument(targetRoot, document)
    if (!result.ok) {
      setAddWorkspaceDialog((current) => current?.kind === 'lark'
        ? {
            ...current,
            importingId: null,
            message: result.message,
            status: result.status
          }
        : current)
      return
    }
    if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(targetRoot)
    setAddWorkspaceDialog(null)
  }

  const toggleLarkDocumentSelection = (documentId: string): void => {
    setAddWorkspaceDialog((current) => {
      if (!current || current.kind !== 'lark') return current
      const document = current.documents.find((item) => item.id === documentId)
      if (!document) return current
      const importedKeys = new Set(current.importedDocumentKeys)
      if (isLarkDocumentAlreadyImported(document, importedKeys)) return current
      const selected = new Set(current.selectedDocumentIds)
      if (selected.has(documentId)) {
        selected.delete(documentId)
      } else {
        selected.add(documentId)
      }
      return { ...current, selectedDocumentIds: [...selected] }
    })
  }

  const toggleAllNewLarkDocuments = (): void => {
    setAddWorkspaceDialog((current) => {
      if (!current || current.kind !== 'lark') return current
      const importedKeys = new Set(current.importedDocumentKeys)
      const newIds = current.documents
        .filter((document) => !isLarkDocumentAlreadyImported(document, importedKeys))
        .map((document) => document.id)
      const selected = new Set(current.selectedDocumentIds)
      const allSelected = newIds.length > 0 && newIds.every((id) => selected.has(id))
      if (allSelected) {
        for (const id of newIds) selected.delete(id)
      } else {
        for (const id of newIds) selected.add(id)
      }
      return { ...current, selectedDocumentIds: [...selected] }
    })
  }

  const importSelectedLarkDocuments = async (): Promise<void> => {
    const current = addWorkspaceDialog
    if (!current || current.kind !== 'lark') return
    const targetRoot = (workspaceRoot || defaultWorkspaceRoot).trim()
    if (!targetRoot) {
      setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
        ? { ...dialog, message: t('writeLarkImportNoWorkspace'), status: 'error' }
        : dialog)
      return
    }

    const importedKeys = new Set(current.importedDocumentKeys)
    const selectedIds = new Set(current.selectedDocumentIds)
    const selectedDocuments = current.documents.filter((document) =>
      selectedIds.has(document.id) && !isLarkDocumentAlreadyImported(document, importedKeys)
    )
    if (selectedDocuments.length === 0) {
      setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
        ? { ...dialog, message: t('writeLarkImportNoSelection'), status: 'enabled' }
        : dialog)
      return
    }

    setFileError(null)
    setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
      ? {
          ...dialog,
          bulkImporting: true,
          importingId: selectedDocuments[0]?.id ?? null,
          message: t('writeLarkImportSelectedProgress', { count: selectedDocuments.length })
        }
      : dialog)
    if (targetRoot !== workspaceRoot || !workspaceRoots.includes(targetRoot)) {
      await addWriteWorkspace(targetRoot)
    }

    let importedCount = 0
    const nextKeys = new Set(importedKeys)
    const importedIds = new Set<string>()
    for (const document of selectedDocuments) {
      setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
        ? { ...dialog, importingId: document.id }
        : dialog)
      const result = await importLarkDocument(targetRoot, document)
      if (!result.ok) {
        setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
          ? {
              ...dialog,
              bulkImporting: false,
              importingId: null,
              importedDocumentKeys: [...nextKeys],
              selectedDocumentIds: dialog.selectedDocumentIds.filter((id) => !importedIds.has(id)),
              message: t('writeLarkImportSelectedPartialFailed', {
                count: importedCount,
                message: result.message
              }),
              status: result.status
            }
          : dialog)
        return
      }
      importedCount += 1
      importedIds.add(document.id)
      for (const key of larkDocumentKeys(document)) nextKeys.add(key)
    }

    if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(targetRoot)
    setAddWorkspaceDialog((dialog) => dialog?.kind === 'lark'
      ? {
          ...dialog,
          bulkImporting: false,
          importingId: null,
          importedDocumentKeys: [...nextKeys],
          selectedDocumentIds: dialog.selectedDocumentIds.filter((id) => !importedIds.has(id)),
          message: t('writeLarkImportSelectedSuccess', { count: importedCount }),
          status: 'enabled'
        }
      : dialog)
  }

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
          <SidebarCommandRow
            icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
            label={t('claw')}
            onClick={onToggleConnectPhone}
            active={connectPhoneSidebarOpen}
            variant="footer"
          />
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={() => onOpenSettings('write')}
            variant="footer"
          />
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col px-0.5">
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
          onClick={openAddWorkspaceDialog}
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
              onClick={openAddWorkspaceDialog}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {workspaceRoots.length === 0 ? (
            <button
              type="button"
              onClick={openAddWorkspaceDialog}
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
                  actions={
                    active || removable ? (
                      <>
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
                    ) : undefined
                  }
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
      )}
    </SidebarFrame>
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
    {addWorkspaceDialog ? (
      <WriteAddWorkspaceDialog
        dialog={addWorkspaceDialog}
        onClose={() => setAddWorkspaceDialog(null)}
        onChooseLocal={() => void chooseLocalWorkspace()}
        onChooseLark={() => void openLarkImportDialog()}
        onBack={() => setAddWorkspaceDialog({ kind: 'choose' })}
        onQueryChange={(query) =>
          setAddWorkspaceDialog((current) => current?.kind === 'lark' ? { ...current, query } : current)
        }
        onSearch={(query) => void loadLarkDocuments(query)}
        onRefresh={() => {
          const query = addWorkspaceDialog.kind === 'lark' ? addWorkspaceDialog.query : ''
          void loadLarkDocuments(query)
        }}
        onInstallLarkCli={() => void installAndConfigureLarkCli()}
        onConfigureLarkCli={() => void startLarkCliConfigQr()}
        onAuthorizeLark={() => void startLarkDocumentAuthFlow()}
        onOpenSetupUrl={(url) => void openLarkSetupUrl(url)}
        onImport={(document) => void importFromLarkDocument(document)}
        onToggleDocument={toggleLarkDocumentSelection}
        onToggleAllNew={toggleAllNewLarkDocuments}
        onImportSelected={() => void importSelectedLarkDocuments()}
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

function normalizeLarkIdentity(value?: string | null): string {
  return String(value ?? '').trim()
}

function tokenFromLarkDocumentUrl(url?: string | null): string {
  const value = normalizeLarkIdentity(url)
  const match = value.match(/\/(?:docx|doc|wiki)\/([^/?#]+)/)
  return match?.[1] ?? ''
}

function uniqueLarkKeys(values: string[]): string[] {
  return [...new Set(values.map(normalizeLarkIdentity).filter(Boolean))]
}

function larkDocumentKeys(document: {
  id?: string
  url?: string
  token?: string
  documentId?: string | null
}): string[] {
  const tokenFromUrl = tokenFromLarkDocumentUrl(document.url)
  const token = normalizeLarkIdentity(document.token)
  const documentId = normalizeLarkIdentity(document.documentId)
  const url = normalizeLarkIdentity(document.url)
  const id = normalizeLarkIdentity(document.id)
  return uniqueLarkKeys([
    token ? `token:${token}` : '',
    documentId ? `token:${documentId}` : '',
    tokenFromUrl ? `token:${tokenFromUrl}` : '',
    url ? `url:${url}` : '',
    id ? `id:${id}` : ''
  ])
}

function larkImportedDocumentKeys(document: {
  id?: string
  url?: string
  token?: string
  documentId?: string | null
}): string[] {
  return larkDocumentKeys(document)
}

function isLarkDocumentAlreadyImported(
  document: LarkDocumentListItem,
  importedKeys: Set<string>
): boolean {
  return larkDocumentKeys(document).some((key) => importedKeys.has(key))
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
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
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

function WriteAddWorkspaceDialog({
  dialog,
  onClose,
  onChooseLocal,
  onChooseLark,
  onBack,
  onQueryChange,
  onSearch,
  onRefresh,
  onInstallLarkCli,
  onConfigureLarkCli,
  onAuthorizeLark,
  onOpenSetupUrl,
  onImport,
  onToggleDocument,
  onToggleAllNew,
  onImportSelected,
  t
}: {
  dialog: AddWorkspaceDialog
  onClose: () => void
  onChooseLocal: () => void
  onChooseLark: () => void
  onBack: () => void
  onQueryChange: (value: string) => void
  onSearch: (query: string) => void
  onRefresh: () => void
  onInstallLarkCli: () => void
  onConfigureLarkCli: () => void
  onAuthorizeLark: () => void
  onOpenSetupUrl: (url: string) => void
  onImport: (document: LarkDocumentListItem) => void
  onToggleDocument: (documentId: string) => void
  onToggleAllNew: () => void
  onImportSelected: () => void
  t: Translate
}): ReactElement {
  const isLark = dialog.kind === 'lark'
  const setupBusy = isLark && isLarkSetupBusy(dialog.setup)
  const navigationBusy = isLark && (
    dialog.loading ||
    Boolean(dialog.importingId) ||
    dialog.bulkImporting ||
    dialog.setup.kind === 'installing' ||
    dialog.setup.kind === 'configuring'
  )
  const busy = isLark && (dialog.loading || Boolean(dialog.importingId) || dialog.bulkImporting || setupBusy)
  const needsSetup = isLark && dialog.documents.length === 0 && (
    dialog.status === 'disabled' ||
    dialog.status === 'config_required' ||
    dialog.status === 'auth_required' ||
    dialog.setup.kind !== 'idle'
  )
  const importedKeys = isLark ? new Set(dialog.importedDocumentKeys) : new Set<string>()
  const selectedIds = isLark ? new Set(dialog.selectedDocumentIds) : new Set<string>()
  const newDocuments = isLark
    ? dialog.documents.filter((document) => !isLarkDocumentAlreadyImported(document, importedKeys))
    : []
  const newDocumentCount = newDocuments.length
  const selectedNewCount = newDocuments.filter((document) => selectedIds.has(document.id)).length
  const allNewSelected = newDocumentCount > 0 && selectedNewCount === newDocumentCount
  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-[520px] rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        {dialog.kind === 'choose' ? (
          <>
            <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
              {t('writeAddWorkspaceChooseTitle')}
            </h2>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={onChooseLocal}
                className="flex min-h-[68px] items-center gap-3 rounded-xl border border-ds-border bg-ds-main/55 px-3.5 py-3 text-left transition hover:border-accent/35 hover:bg-ds-hover"
              >
                <FolderOpen className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ds-ink">
                    {t('writeAddWorkspaceFromLocal')}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-ds-muted">
                    {t('writeAddWorkspaceFromLocalSub')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={onChooseLark}
                className="flex min-h-[68px] items-center gap-3 rounded-xl border border-ds-border bg-ds-main/55 px-3.5 py-3 text-left transition hover:border-accent/35 hover:bg-ds-hover"
              >
                <Cloud className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ds-ink">
                    {t('writeAddWorkspaceFromLark')}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-ds-muted">
                    {t('writeAddWorkspaceFromLarkSub')}
                  </span>
                </span>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('writeEntryDialogCancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
                  {t('writeLarkImportTitle')}
                </h2>
                <p className="mt-1 text-[12.5px] leading-5 text-ds-muted">
                  {t('writeLarkImportSub')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleAllNew}
                  disabled={busy || newDocumentCount === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                  title={allNewSelected ? t('writeLarkImportClearSelection') : t('writeLarkImportSelectAllNew')}
                  aria-label={allNewSelected ? t('writeLarkImportClearSelection') : t('writeLarkImportSelectAllNew')}
                >
                  <span>{allNewSelected ? t('writeLarkImportClearSelection') : t('writeLarkImportSelectAllNew')}</span>
                </button>
                <button
                  type="button"
                  onClick={onImportSelected}
                  disabled={busy || selectedNewCount === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                  title={t('writeLarkImportSelectedTitle')}
                  aria-label={t('writeLarkImportSelectedTitle')}
                >
                  {dialog.bulkImporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  <span>{t('writeLarkImportSelectedShort', { count: selectedNewCount })}</span>
                </button>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={busy}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                  aria-label={t('writeLarkImportRefresh')}
                  title={t('writeLarkImportRefresh')}
                >
                  {dialog.loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                onSearch(dialog.query)
              }}
            >
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" strokeWidth={1.75} />
                <input
                  value={dialog.query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={t('writeLarkImportSearchPlaceholder')}
                  className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/65 pl-9 pr-3 text-[14px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('writeLarkImportSearch')}
              </button>
            </form>

            {dialog.message ? (
              <div
                className={`mt-3 rounded-xl border px-3 py-2 text-[12.5px] leading-5 ${
                  dialog.status === 'error' ||
                  dialog.status === 'disabled' ||
                  dialog.status === 'config_required' ||
                  dialog.status === 'auth_required'
                    ? 'border-red-200/70 bg-red-50/80 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
                    : 'border-ds-border bg-ds-main/55 text-ds-muted'
                }`}
              >
                {dialog.message}
              </div>
            ) : null}

            <div className="mt-3 max-h-[320px] min-h-[140px] overflow-y-auto rounded-xl border border-ds-border bg-ds-main/35 p-1.5">
              {needsSetup ? (
                <LarkSetupPanel
                  status={dialog.status}
                  setup={dialog.setup}
                  onInstall={onInstallLarkCli}
                  onConfigure={onConfigureLarkCli}
                  onAuthorize={onAuthorizeLark}
                  onOpenUrl={onOpenSetupUrl}
                  t={t}
                />
              ) : null}

              {!needsSetup && dialog.loading && dialog.documents.length === 0 ? (
                <div className="flex h-[128px] items-center justify-center text-[13px] text-ds-muted">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.75} />
                  {t('writeLoadingShort')}
                </div>
              ) : null}

              {!needsSetup && !dialog.loading && dialog.documents.length === 0 ? (
                <div className="flex h-[128px] items-center justify-center text-[13px] text-ds-muted">
                  {t('writeLarkImportEmpty')}
                </div>
              ) : null}

              {dialog.documents.map((document) => {
                const importing = dialog.importingId === document.id
                const alreadyImported = isLarkDocumentAlreadyImported(document, importedKeys)
                const selected = selectedIds.has(document.id)
                return (
                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition hover:bg-ds-hover"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busy || alreadyImported}
                      onChange={() => onToggleDocument(document.id)}
                      className="h-4 w-4 shrink-0 accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('writeLarkImportSelectDocument', { title: document.title })}
                    />
                    <FileText className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-ds-ink" title={document.title}>
                        {document.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ds-muted">
                        {document.ownerName ? (
                          <span className="truncate">{document.ownerName}</span>
                        ) : null}
                        {formatLarkDocumentDate(document.updatedAt) ? (
                          <span>{formatLarkDocumentDate(document.updatedAt)}</span>
                        ) : null}
                        {(document.matchedBy ?? []).slice(0, 2).map((label) => (
                          <span key={label} className="rounded-md bg-ds-card px-1.5 py-0.5 text-ds-faint">
                            {label}
                          </span>
                        ))}
                        <span className={`rounded-md px-1.5 py-0.5 ${
                          alreadyImported
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-accent/10 text-accent'
                        }`}>
                          {alreadyImported ? t('writeLarkImportAlreadyImported') : t('writeLarkImportNewBadge')}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onImport(document)}
                      disabled={busy || alreadyImported}
                      className="inline-flex h-8 shrink-0 items-center rounded-lg bg-accent px-2.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {importing ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                      ) : null}
                      {alreadyImported ? t('writeLarkImportAlreadyImported') : importing ? t('writeLarkImporting') : t('writeLarkImportAction')}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex justify-between gap-2">
              <button
                type="button"
                onClick={onBack}
                disabled={navigationBusy}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('writeLarkImportBack')}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={navigationBusy}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('writeEntryDialogCancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function formatLarkDocumentDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function LarkSetupPanel({
  status,
  setup,
  onInstall,
  onConfigure,
  onAuthorize,
  onOpenUrl,
  t
}: {
  status?: LarkDocumentStatus
  setup: LarkSetupState
  onInstall: () => void
  onConfigure: () => void
  onAuthorize: () => void
  onOpenUrl: (url: string) => void
  t: Translate
}): ReactElement {
  const busy = isLarkSetupBusy(setup)
  const showInstall = status === 'disabled' && setup.kind === 'idle'
  const showConfigure = status === 'config_required' && setup.kind === 'idle'
  const showAuthorize = status === 'auth_required' && setup.kind === 'idle'
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-4 py-5 text-center">
      {setup.kind === 'installing' ? (
        <LarkSetupSpinner label={t('writeLarkSetupInstalling')} />
      ) : null}
      {setup.kind === 'config-loading' ? (
        <LarkSetupSpinner label={t('writeLarkConfigQrLoading')} />
      ) : null}
      {setup.kind === 'configuring' ? (
        <LarkSetupSpinner label={t('writeLarkConfigApplying')} />
      ) : null}
      {setup.kind === 'auth-starting' ? (
        <LarkSetupSpinner label={t('writeLarkAuthStarting')} />
      ) : null}

      {setup.kind === 'config-qr' ? (
        <LarkQrPanel
          title={t('writeLarkConfigQrTitle')}
          description={t('writeLarkConfigQrDesc')}
          url={setup.url}
          userCode={setup.userCode}
          error={setup.error}
          onOpenUrl={onOpenUrl}
          t={t}
        />
      ) : null}

      {setup.kind === 'auth-qr' ? (
        <LarkQrPanel
          title={t('writeLarkAuthQrTitle')}
          description={setup.completing ? t('writeLarkAuthQrDesc') : t('writeLarkAuthRetryDesc')}
          url={setup.verificationUrl}
          userCode={setup.userCode ?? ''}
          error={setup.error}
          trailing={setup.completing ? <LarkSetupSpinner label={t('writeLarkAuthWaiting')} compact /> : null}
          onOpenUrl={onOpenUrl}
          t={t}
        />
      ) : null}

      {setup.kind === 'ready' ? (
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          {setup.message}
        </div>
      ) : null}

      {showInstall || showConfigure || showAuthorize ? (
        <>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            {showInstall ? (
              <Download className="h-5 w-5" strokeWidth={1.8} />
            ) : (
              <KeyRound className="h-5 w-5" strokeWidth={1.8} />
            )}
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ds-ink">
              {showInstall
                ? t('writeLarkSetupInstallTitle')
                : showConfigure
                  ? t('writeLarkConfigRequiredTitle')
                  : t('writeLarkAuthRequiredTitle')}
            </div>
            <div className="mt-1 max-w-[360px] text-[12.5px] leading-5 text-ds-muted">
              {showInstall
                ? t('writeLarkSetupInstallDesc')
                : showConfigure
                  ? t('writeLarkConfigRequiredDesc')
                  : t('writeLarkAuthRequiredDesc')}
            </div>
          </div>
          <button
            type="button"
            onClick={showInstall ? onInstall : showConfigure ? onConfigure : onAuthorize}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {showInstall
              ? t('writeLarkSetupInstallAction')
              : showConfigure
                ? t('writeLarkConfigRequiredAction')
                : t('writeLarkAuthRequiredAction')}
          </button>
        </>
      ) : null}
    </div>
  )
}

function LarkSetupSpinner({
  label,
  compact = false
}: {
  label: string
  compact?: boolean
}): ReactElement {
  return (
    <div className={`inline-flex items-center gap-2 text-[12.5px] text-ds-muted ${compact ? '' : 'py-3'}`}>
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
      {label}
    </div>
  )
}

function LarkQrPanel({
  title,
  description,
  url,
  userCode,
  error,
  trailing,
  onOpenUrl,
  t
}: {
  title: string
  description: string
  url: string
  userCode?: string
  error?: string
  trailing?: ReactElement | null
  onOpenUrl: (url: string) => void
  t: Translate
}): ReactElement {
  return (
    <div className="grid justify-items-center gap-2">
      <div className="rounded-2xl border border-ds-border bg-white p-3 shadow-sm">
        <QRCodeSVG value={url} size={156} marginSize={1} />
      </div>
      <div className="text-[14px] font-semibold text-ds-ink">{title}</div>
      <div className="max-w-[360px] text-[12.5px] leading-5 text-ds-muted">{description}</div>
      {userCode ? (
        <div className="rounded-lg border border-ds-border bg-ds-card px-2 py-1 text-[12px] font-semibold text-ds-ink">
          {userCode}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onOpenUrl(url)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t('writeLarkOpenAuthLink')}
      </button>
      {trailing}
      {error ? (
        <div className="max-w-[360px] text-[12px] leading-5 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function isLarkSetupBusy(setup: LarkSetupState): boolean {
  return (
    setup.kind === 'installing' ||
    setup.kind === 'config-loading' ||
    setup.kind === 'configuring' ||
    setup.kind === 'auth-starting' ||
    (setup.kind === 'auth-qr' && setup.completing)
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
