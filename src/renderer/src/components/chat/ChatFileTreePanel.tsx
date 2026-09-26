import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderSearch,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import type { TFunction } from 'i18next'
import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  formatComposerFileMentionToken,
  relativeWorkspacePath
} from '../../lib/composer-file-references'
import {
  workspaceFileKindLabel,
  workspaceFilePreviewKind
} from '../../lib/workspace-text-preview'
import {
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import {
  chatFileTreeDisplayName,
  chatFileTreeEntryMatchesQuery,
  chatFileTreeEntryReference,
  chatFileTreePathKey,
  chatFileTreeUniqueRoots,
  formatChatFileTreeUnsupportedMessage,
  isChatFileTreeIgnoredDirectory,
  isChatFileTreePreviewableEntry,
  owningChatFileTreeRoot,
  scanChatFileTreeRecentFilesInRoots,
  sortChatFileTreeEntries,
  type ChatFileTreeReference,
  type FileTreeSortMode
} from './chat-file-tree-helpers'

export type { ChatFileTreeReference } from './chat-file-tree-helpers'
export {
  chatFileTreeEntryMatchesQuery,
  compareChatFileTreeEntriesByModified,
  compareChatFileTreeEntriesByName,
  formatChatFileTreeUnsupportedMessage,
  isChatFileTreeIgnoredDirectory,
  isChatFileTreePreviewableEntry,
  scanChatFileTreeRecentFiles,
  sortChatFileTreeEntries
} from './chat-file-tree-helpers'

type Props = {
  workspaceRoot: string
  extraRoots?: readonly string[]
  selectedPath?: string | null
  onPreviewFile: (path: string, workspaceRoot?: string) => void
  onAddReference: (reference: ChatFileTreeReference) => void
  t: TFunction
  fill?: boolean
}

type DirectoryState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

type ContextMenuState = {
  x: number
  y: number
  entry: WorkspaceEntry
} | null

type RecentScanState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

const ROOT_PATH = ''

export function ChatFileTreePanel({
  workspaceRoot,
  extraRoots = [],
  selectedPath,
  onPreviewFile,
  onAddReference,
  t,
  fill = false
}: Props): ReactElement | null {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_PATH]))
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [sortMode, setSortMode] = useState<FileTreeSortMode>('name')
  const [query, setQuery] = useState('')
  const [recentScan, setRecentScan] = useState<RecentScanState>({ entries: [], loading: false, error: null })
  const [recentScanNonce, setRecentScanNonce] = useState(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const roots = useMemo(() => chatFileTreeUniqueRoots(workspaceRoot, extraRoots), [workspaceRoot, extraRoots])
  const root = roots[0] ?? ''
  const multiRoot = roots.length > 1
  const rootsKey = roots.join('\n')
  const rootName = useMemo(() => chatFileTreeDisplayName(root), [root])
  const owningRoot = useCallback((path: string): string => owningChatFileTreeRoot(path, roots), [roots])

  useEffect(() => {
    setExpanded(new Set(multiRoot ? roots : [ROOT_PATH]))
    setDirectories({})
    setContextMenu(null)
    setQuery('')
    setRecentScan({ entries: [], loading: false, error: null })
  }, [rootsKey, multiRoot, roots])

  const loadDirectory = useCallback((path: string): void => {
    if (!root || typeof window.kunGui?.listWorkspaceDirectory !== 'function') return
    const directoryPath = path || root
    const workspace = owningChatFileTreeRoot(directoryPath, roots)
    setDirectories((current) => ({
      ...current,
      [path || ROOT_PATH]: {
        entries: current[path || ROOT_PATH]?.entries ?? [],
        loading: true,
        error: null
      }
    }))
    void window.kunGui
      .listWorkspaceDirectory({
        workspaceRoot: workspace || root,
        path: directoryPath
      })
      .then((result) => {
        setDirectories((current) => ({
          ...current,
          [path || ROOT_PATH]: result.ok
            ? { entries: result.entries, loading: false, error: null }
            : { entries: [], loading: false, error: result.message }
        }))
      })
      .catch((error) => {
        setDirectories((current) => ({
          ...current,
          [path || ROOT_PATH]: {
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      })
  }, [owningRoot, root, roots])

  useEffect(() => {
    for (const path of expanded) {
      const state = directories[path || ROOT_PATH]
      if (!state) loadDirectory(path)
    }
  }, [directories, expanded, loadDirectory, root])

  useEffect(() => {
    const listWorkspaceDirectory = window.kunGui?.listWorkspaceDirectory?.bind(window.kunGui)
    if (!root || typeof listWorkspaceDirectory !== 'function') return
    let cancelled = false
    setRecentScan({ entries: [], loading: true, error: null })

    void (async () => {
      try {
        const entries = await scanChatFileTreeRecentFilesInRoots(roots, listWorkspaceDirectory, {
          isCancelled: () => cancelled
        })
        if (!cancelled) {
          setRecentScan({
            entries,
            loading: false,
            error: null
          })
        }
      } catch (error) {
        if (!cancelled) {
          setRecentScan({
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rootsKey, recentScanNonce, roots])

  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const selectedKey = useMemo(() => chatFileTreePathKey(selectedPath ?? ''), [selectedPath])
  const recentEntries = recentScan.entries.filter((entry) =>
    chatFileTreeEntryMatchesQuery(entry, owningRoot(entry.path) || root, query)
  )

  if (!root) return null

  const toggleDirectory = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const refresh = (): void => {
    setDirectories({})
    setExpanded(new Set(multiRoot ? roots : [ROOT_PATH]))
    setRecentScan((current) => ({
      entries: current.entries,
      loading: true,
      error: null
    }))
    setRecentScanNonce((value) => value + 1)
  }

  const addReference = (entry: WorkspaceEntry): void => {
    onAddReference(chatFileTreeEntryReference(entry, owningRoot(entry.path) || root))
    setContextMenu(null)
  }

  const setEntryDragData = (event: ReactDragEvent<HTMLElement>, entry: WorkspaceEntry): void => {
    const reference = chatFileTreeEntryReference(entry, owningRoot(entry.path) || root)
    const token = formatComposerFileMentionToken(reference.relativePath, reference.type === 'directory')
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', `${token} `)
    event.dataTransfer.setData(COMPOSER_FILE_REFERENCE_DRAG_MIME, JSON.stringify(reference))
  }

  const copyEntryPath = async (entry: WorkspaceEntry, mode: 'absolute' | 'relative'): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    const workspace = owningRoot(entry.path) || root
    const value = mode === 'absolute' ? entry.path : relativeWorkspacePath(entry.path, workspace)
    await navigator.clipboard.writeText(value)
    setContextMenu(null)
  }

  const revealEntry = async (entry: WorkspaceEntry): Promise<void> => {
    if (typeof window.kunGui?.openEditorPath !== 'function') return
    await window.kunGui.openEditorPath({
      path: entry.path,
      workspaceRoot: owningRoot(entry.path) || root,
      editorId: 'file-manager'
    })
    setContextMenu(null)
  }

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>, entry: WorkspaceEntry): void => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry
    })
  }

  const renderDirectory = (path: string, depth: number): ReactElement[] => {
    const state = directories[path || ROOT_PATH]
    if (state?.loading && (!state.entries.length || depth === 0)) {
      return [
        <div
          key={`${path}-loading`}
          className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ds-muted"
          style={{ paddingLeft: depth * 14 + 10 }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {t('fileTreeLoading')}
        </div>
      ]
    }
    if (state?.error) {
      return [
        <div
          key={`${path}-error`}
          className="px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300"
          style={{ paddingLeft: depth * 14 + 10 }}
          title={state.error}
        >
          {state.error}
        </div>
      ]
    }
    if (!state?.entries.length) {
      return depth === 0
        ? [
            <div key={`${path}-empty`} className="px-2.5 py-2 text-[12px] text-ds-muted">
              {t('fileTreeEmpty')}
            </div>
          ]
        : []
    }

    const hasMatchingLoadedDescendant = (entry: WorkspaceEntry): boolean => {
      if (chatFileTreeEntryMatchesQuery(entry, owningRoot(entry.path) || root, query)) return true
      if (entry.type !== 'directory') return false
      const childState = directories[entry.path]
      return Boolean(childState?.entries.some((child) => hasMatchingLoadedDescendant(child)))
    }

    return sortChatFileTreeEntries(state.entries, sortMode)
      .filter((entry) => entry.type !== 'directory' || !isChatFileTreeIgnoredDirectory(entry.name))
      .filter((entry) => hasMatchingLoadedDescendant(entry))
      .flatMap((entry) => {
        const isDirectory = entry.type === 'directory'
        const entryExpanded = expanded.has(entry.path) || Boolean(query.trim() && directories[entry.path])
        const previewable = isChatFileTreePreviewableEntry(entry)
        const active = !isDirectory && selectedKey === chatFileTreePathKey(entry.path)
        const previewKind = workspaceFilePreviewKind(entry.path || entry.name)
        const icon = isDirectory
          ? entryExpanded
            ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
            : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
          : <FileText className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
        const row = (
          <div
            key={entry.path}
            draggable
            onDragStart={(event) => setEntryDragData(event, entry)}
          >
            <SidebarTreeRow
              title={previewable || isDirectory ? entry.path : formatChatFileTreeUnsupportedMessage(entry.name)}
              active={active}
              onClick={() => {
                if (isDirectory) {
                  toggleDirectory(entry.path)
                  return
                }
                onPreviewFile(entry.path, owningRoot(entry.path) || root)
              }}
              onContextMenu={(event) => openContextMenu(event, entry)}
              buttonClassName="h-7 items-center gap-1.5 py-0 pr-1.5 text-[12px]"
              buttonStyle={{ paddingLeft: depth * 14 + 8 }}
              trailing={
                isDirectory ? (
                  entryExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  )
                ) : (
                  <span
                    className={`min-w-[28px] rounded-[4px] px-1 py-0.5 text-center text-[8.5px] font-semibold tracking-wide ${
                      previewKind === 'unsupported'
                        ? 'bg-ds-hover text-ds-faint'
                        : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {workspaceFileKindLabel(entry.path || entry.name)}
                  </span>
                )
              }
            >
              {icon}
              <span className={previewable || isDirectory ? 'min-w-0 truncate' : 'min-w-0 truncate text-ds-faint'}>
                {entry.name}
              </span>
            </SidebarTreeRow>
          </div>
        )
        if (!isDirectory || !entryExpanded) return [row]
        return [row, ...renderDirectory(entry.path, depth + 1)]
      })
  }

  const contextEntry = contextMenu?.entry
  const contextLabel = contextEntry?.type === 'directory'
    ? t('fileTreeAddFolderReference')
    : t('fileTreeAddFileReference')
  const sortTitle = sortMode === 'modified'
    ? t('fileTreeSortByName', { defaultValue: 'Sort by name' })
    : t('fileTreeSortByModifiedTime', { defaultValue: 'Sort by modified time' })

  return (
    <div className={`ds-no-drag min-h-0 ${fill ? 'flex h-full flex-col' : ''}`}>
      <SidebarSectionHeader
        label={multiRoot ? t('fileTreeTitle') : (rootName || t('fileTreeTitle'))}
        title={multiRoot ? `${root}\n${t('fileTreeGitUsesPrimary')}` : root}
        actions={
          <>
            <SidebarIconButton
              title={sortTitle}
              ariaLabel={sortTitle}
              active={sortMode === 'modified'}
              onClick={() => setSortMode((mode) => mode === 'modified' ? 'name' : 'modified')}
            >
              <span className="text-[11px] font-semibold">{sortMode === 'modified' ? 'MT' : 'AZ'}</span>
            </SidebarIconButton>
            <SidebarIconButton
              title={t('fileTreeRefresh')}
              ariaLabel={t('fileTreeRefresh')}
              onClick={refresh}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            </SidebarIconButton>
          </>
        }
      />
      <div className="px-2 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card/70 px-2.5 transition focus-within:border-accent/45 focus-within:bg-ds-card">
          <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('fileTreeSearchPlaceholder', { defaultValue: 'Filter loaded files' })}
            aria-label={t('fileTreeSearchPlaceholder', { defaultValue: 'Filter loaded files' })}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('fileTreeClearSearch', { defaultValue: 'Clear file filter' })}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </label>
      </div>
      {recentEntries.length || recentScan.loading || recentScan.error ? (
        <div className="border-b border-ds-border-muted/60 px-1 pb-2">
          <div className="px-2.5 pb-1 text-[11px] font-medium text-ds-faint">
            {t('fileTreeRecentModifiedFiles', { defaultValue: 'Recent modified files' })}
          </div>
          <div className="flex flex-col gap-0.5">
            {recentScan.loading ? (
              <div className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-ds-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                {t('fileTreeScanningRecent', { defaultValue: 'Scanning workspace…' })}
              </div>
            ) : recentScan.error ? (
              <div className="px-2.5 py-1 text-[12px] text-red-700 dark:text-red-300" title={recentScan.error}>
                {recentScan.error}
              </div>
            ) : recentEntries.map((entry) => (
              <button
                key={`recent-${entry.path}`}
                type="button"
                draggable
                onDragStart={(event) => setEntryDragData(event, entry)}
                onClick={() => onPreviewFile(entry.path, owningRoot(entry.path) || root)}
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                title={entry.path}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 truncate">{relativeWorkspacePath(entry.path, owningRoot(entry.path) || root)}</span>
                <span className="ml-auto shrink-0 text-[9px] font-semibold text-ds-faint">
                  {workspaceFileKindLabel(entry.path)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`${fill ? 'min-h-0 flex-1' : 'max-h-[34vh] min-h-[96px]'} overflow-y-auto overflow-x-hidden px-1`}>
        {multiRoot
          ? roots.flatMap((treeRoot) => {
              const expandedRoot = expanded.has(treeRoot) || Boolean(query.trim() && directories[treeRoot])
              return [
                <SidebarTreeRow
                  key={treeRoot}
                  title={treeRoot}
                  active={false}
                  onClick={() => toggleDirectory(treeRoot)}
                  buttonClassName="h-7 items-center gap-1.5 py-0 pr-1.5 text-[12px]"
                  trailing={
                    expandedRoot
                      ? <ChevronDown className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                      : <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  }
                >
                  {expandedRoot
                    ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                    : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />}
                  <span className="min-w-0 truncate">{chatFileTreeDisplayName(treeRoot)}</span>
                </SidebarTreeRow>,
                ...(expandedRoot ? renderDirectory(treeRoot, 1) : [])
              ]
            })
          : renderDirectory(ROOT_PATH, 0)}
      </div>
      {contextEntry ? (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[190px] rounded-lg border border-ds-border bg-ds-card p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => addReference(contextEntry)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Plus className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{contextLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyEntryPath(contextEntry, 'absolute')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Copy className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{t('fileTreeCopyAbsolutePath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyEntryPath(contextEntry, 'relative')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Copy className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{t('fileTreeCopyRelativePath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void revealEntry(contextEntry)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <FolderSearch className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">
              {window.kunGui?.platform === 'darwin'
                ? t('fileTreeRevealInFinder')
                : t('fileTreeRevealInFileManager')}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
