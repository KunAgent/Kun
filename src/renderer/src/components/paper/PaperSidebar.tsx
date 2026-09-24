import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Compass,
  Folder,
  FolderOpen,
  FolderSearch,
  GraduationCap,
  Import,
  LibraryBig,
  Plus,
  RefreshCw,
  Settings,
  Smartphone,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { confirmDialog } from '../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { revealWorkspacePathInFileManager } from '../../lib/open-workspace-path'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath
} from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import {
  addPaperLibrary,
  removePaperLibrary,
  switchPaperLibrary
} from '../../paper/paper-mode-actions'
import { openPdfAsPaper } from '../../write/paper/paper-actions'
import { usePaperStore } from '../../write/paper/paper-store'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSearchField,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'
import { WriteFileTree } from '../write/WriteFileTree'
import { PaperModeToggle } from './PaperModeToggle'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  focusModeEnabled: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
}

const STATUS_CHIPS = [
  { key: 'all', labelKey: 'writePaperFilterAll' },
  { key: 'recent', labelKey: 'writePaperFilterRecent' },
  { key: 'unread', labelKey: 'writePaperFilterUnread' },
  { key: 'reading', labelKey: 'writePaperFilterReading' },
  { key: 'read', labelKey: 'writePaperFilterRead' }
] as const

/**
 * Papers-surface sidebar (§3.3): mode toggle, library switcher, search +
 * status/tag/group filters that drive the library table, discover entry, and
 * a read-only file tree rooted at the active library.
 */
export function PaperSidebar({
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
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const {
    workspaceRoot,
    rootDirectory,
    entriesByDir,
    expandedDirs,
    loadingDirs,
    treeError,
    activeFilePath,
    paperMode,
    paperReading,
    toggleDirectory,
    openFile,
    refreshWorkspace,
    setFileError
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      rootDirectory: s.rootDirectory,
      entriesByDir: s.entriesByDir,
      expandedDirs: s.expandedDirs,
      loadingDirs: s.loadingDirs,
      treeError: s.treeError,
      activeFilePath: s.activeFilePath,
      paperMode: s.paperMode,
      paperReading: s.paperReading,
      toggleDirectory: s.toggleDirectory,
      openFile: s.openFile,
      refreshWorkspace: s.refreshWorkspace,
      setFileError: s.setFileError
    }))
  )
  const {
    view,
    filter,
    counts,
    tags,
    groups,
    setView,
    setFilter,
    setImportDialogOpen
  } = usePaperModeStore(
    useShallow((s) => ({
      view: s.view,
      filter: s.filter,
      counts: s.counts,
      tags: s.tags,
      groups: s.groups,
      setView: s.setView,
      setFilter: s.setFilter,
      setImportDialogOpen: s.setImportDialogOpen
    }))
  )

  const root = rootDirectory || workspaceRoot
  const activeLibrary = normalizePath(paperMode.activeLibrary)
  const statusCounts: Record<string, number> = {
    all: counts.total,
    unread: counts.unread,
    reading: counts.reading,
    read: counts.read
  }
  const activeChip = filter.recent
    ? 'recent'
    : filter.status === ''
      ? 'all'
      : filter.status

  const applyFilter = (patch: Parameters<typeof setFilter>[0]): void => {
    setFilter(patch)
    setView('library')
  }

  const pickPaperLibrary = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(activeLibrary || undefined)
      if (!picked.canceled && picked.path) {
        const result = await addPaperLibrary(picked.path)
        if (!result.ok) {
          setFileError(result.message)
        }
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const removeLibrary = async (libraryPath: string): Promise<void> => {
    if (!(await confirmDialog(
      t('writePaperModeRemoveLibraryConfirm', { name: writeBasenameFromPath(libraryPath) })
    ))) return
    const result = await removePaperLibrary(libraryPath)
    if (!result.ok) setFileError(result.message)
  }

  return (
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
        <PaperModeToggle />
        <SidebarCommandRow
          icon={<Import className="h-4 w-4" strokeWidth={1.9} />}
          label={t('writePaperImport')}
          onClick={() => setImportDialogOpen(true)}
          variant="accent"
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
            label={t('writePaperModeLibraries')}
            actions={
              <SidebarIconButton
                onClick={() => void pickPaperLibrary()}
                title={t('writePaperModeAddLibrary')}
                ariaLabel={t('writePaperModeAddLibrary')}
                stopPropagation
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </SidebarIconButton>
            }
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {paperMode.libraries.length === 0 ? (
              <button
                type="button"
                onClick={() => void pickPaperLibrary()}
                className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {t('writePaperModeAddLibrary')}
                </span>
              </button>
            ) : null}

            {paperMode.libraries.map((libraryPath) => {
              const normalized = normalizePath(libraryPath)
              const active = normalized === activeLibrary
              return (
                <div key={normalized} className="mb-1">
                  <SidebarTreeRow
                    active={active}
                    title={libraryPath}
                    onClick={() => {
                      if (!active) void switchPaperLibrary(libraryPath)
                    }}
                    className="min-h-[36px]"
                    buttonClassName="items-center gap-2 px-2.5 py-2"
                    actions={(
                      <>
                        <SidebarIconButton
                          onClick={() => void revealWorkspacePathInFileManager(libraryPath, libraryPath)}
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
                        <SidebarIconButton
                          onClick={() => void removeLibrary(libraryPath)}
                          title={t('writePaperModeRemoveLibrary')}
                          ariaLabel={t('writePaperModeRemoveLibrary')}
                          tone="danger"
                          stopPropagation
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        </SidebarIconButton>
                      </>
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">
                      {writeBasenameFromPath(libraryPath)}
                    </span>
                  </SidebarTreeRow>
                  {active ? (
                    <div className="px-2.5 pb-1 text-[11.5px] text-ds-faint">
                      <span className="block truncate" title={libraryPath}>{libraryPath}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}

            <div className="px-1 pt-2">
              <SidebarSearchField
                value={filter.query}
                placeholder={t('writePaperSearchPlaceholder')}
                clearLabel={t('clearSearch')}
                onChange={(query) => applyFilter({ query })}
              />
            </div>

            <div className="flex flex-wrap gap-1 px-2 pt-2" role="group" aria-label={t('writePaperFilterStatus')}>
              {STATUS_CHIPS.map(({ key, labelKey }) => {
                const active = activeChip === key
                const count = statusCounts[key]
                return (
                  <button
                    key={key}
                    type="button"
                    data-cursor-spotlight-target
                    onClick={() => applyFilter(
                      key === 'recent'
                        ? { recent: true, status: '' }
                        : key === 'all'
                          ? { recent: false, status: '' }
                          : { recent: false, status: key }
                    )}
                    className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] transition ${
                      active
                        ? 'border-accent/40 bg-accent/10 font-medium text-accent'
                        : 'border-ds-border-muted bg-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                    }`}
                  >
                    {t(labelKey)}
                    {typeof count === 'number' ? (
                      <span className="text-[10.5px] text-ds-faint">{count}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {tags.length > 0 || groups.length > 0 ? (
              <div className="flex flex-col gap-1.5 px-2 pt-2">
                {tags.length > 0 ? (
                  <select
                    value={filter.tag}
                    onChange={(event) => applyFilter({ tag: event.target.value })}
                    className="h-8 w-full rounded-lg border border-ds-border-muted bg-transparent px-2 text-[12px] text-ds-ink outline-none focus:border-accent/55"
                    aria-label={t('writePaperFilterTag')}
                  >
                    <option value="">{t('writePaperFilterTagAll')}</option>
                    {tags.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                ) : null}
                {groups.length > 0 ? (
                  <select
                    value={filter.group}
                    onChange={(event) => applyFilter({ group: event.target.value })}
                    className="h-8 w-full rounded-lg border border-ds-border-muted bg-transparent px-2 text-[12px] text-ds-ink outline-none focus:border-accent/55"
                    aria-label={t('writePaperFilterGroup')}
                  >
                    <option value="">{t('writePaperFilterGroupAll')}</option>
                    {groups.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            <div className="pt-1">
              <SidebarCommandRow
                icon={<LibraryBig className="h-4 w-4" strokeWidth={1.9} />}
                label={t('writePaperModeLibraryView')}
                onClick={() => setView('library')}
                active={view === 'library'}
              />
              <SidebarCommandRow
                icon={<Compass className="h-4 w-4" strokeWidth={1.9} />}
                label={t('writePaperModeDiscover')}
                onClick={() => setView('discover')}
                active={view === 'discover'}
              />
            </div>

            <SidebarSectionHeader
              label={t('writePaperModeFiles')}
              actions={
                <SidebarIconButton
                  onClick={() => void refreshWorkspace(workspaceRoot)}
                  title={t('writeRefreshWorkspace')}
                  ariaLabel={t('writeRefreshWorkspace')}
                  stopPropagation
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                </SidebarIconButton>
              }
            />
            <WriteFileTree
              rootDirectory={root}
              entriesByDir={entriesByDir}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              selectedFilePath={activeFilePath}
              error={treeError}
              rootLoading={Boolean(
                loadingDirs.__root__ || loadingDirs[root] || (workspaceRoot.trim() && !entriesByDir[root])
              )}
              onToggleDir={(path) => void toggleDirectory(workspaceRoot, path)}
              onSelectFile={(path) => {
                setView('reader')
                void openFile(workspaceRoot, path)
              }}
              onRevealEntry={(entry) =>
                void revealWorkspacePathInFileManager(entry.path, workspaceRoot)
              }
              onOpenPdfAsPaper={(entry) =>
                void openPdfAsPaper({
                  workspaceRoot,
                  settings: paperReading,
                  t,
                  pdfPath: entry.path
                })
              }
              openPdfAsPaperTitle={t('writePaperOpenAsPaper')}
              onRefresh={() => void refreshWorkspace(workspaceRoot)}
              showHeader={false}
              showRootLabel={false}
            />
          </div>
        </div>
      )}
    </SidebarFrame>
  )
}
