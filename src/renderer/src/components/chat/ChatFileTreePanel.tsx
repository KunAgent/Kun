import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry
} from '@shared/workspace-file'
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
  RefreshCw
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
import type { ComposerFileReference } from '../../lib/composer-file-references'
import {
  formatComposerFileMentionToken,
  relativeWorkspacePath
} from '../../lib/composer-file-references'
import { isWorkspaceTextPreviewPath } from '../../lib/workspace-text-preview'
import {
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'

export type ChatFileTreeReference = ComposerFileReference & {
  type: 'file' | 'directory'
}

type Props = {
  workspaceRoot: string
  selectedPath?: string | null
  onPreviewFile: (path: string) => void
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

type FileTreeSortMode = 'name' | 'modified'

type ListWorkspaceDirectory = (target: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>

type RecentScanState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

type RecentScanOptions = {
  isCancelled?: () => boolean
  limit?: number
  maxDepth?: number
  maxEntries?: number
}

const ROOT_PATH = ''
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules'])
const RECENT_FILE_LIMIT = 8
const RECENT_SCAN_MAX_ENTRIES = 2_000
const RECENT_SCAN_MAX_DEPTH = 8

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

function workspaceDisplayName(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function entryReference(entry: WorkspaceEntry, workspaceRoot: string): ChatFileTreeReference {
  const relativePath = relativeWorkspacePath(entry.path, workspaceRoot)
  return {
    path: entry.path,
    relativePath,
    name: entry.name,
    type: entry.type
  }
}

export function compareChatFileTreeEntriesByName(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareChatFileTreeEntriesByModified(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  const leftTime = left.mtimeMs ?? 0
  const rightTime = right.mtimeMs ?? 0
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareChatFileTreeEntriesByName(left, right)
}

export function sortChatFileTreeEntries(entries: WorkspaceEntry[], mode: FileTreeSortMode): WorkspaceEntry[] {
  return [...entries].sort(mode === 'modified' ? compareChatFileTreeEntriesByModified : compareChatFileTreeEntriesByName)
}

function sortRecentFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries]
    .filter(isChatFileTreePreviewableEntry)
    .sort((left, right) => {
      const leftTime = left.mtimeMs ?? 0
      const rightTime = right.mtimeMs ?? 0
      if (leftTime !== rightTime) return rightTime - leftTime
      return compareChatFileTreeEntriesByName(left, right)
    })
}

export async function scanChatFileTreeRecentFiles(
  root: string,
  listWorkspaceDirectory: ListWorkspaceDirectory,
  options: RecentScanOptions = {}
): Promise<WorkspaceEntry[]> {
  const limit = options.limit ?? RECENT_FILE_LIMIT
  const maxDepth = options.maxDepth ?? RECENT_SCAN_MAX_DEPTH
  const maxEntries = options.maxEntries ?? RECENT_SCAN_MAX_ENTRIES
  const isCancelled = options.isCancelled ?? (() => false)
  const collected: WorkspaceEntry[] = []

  const scanDirectory = async (
    path: string,
    depth: number,
    seenDirectories: Set<string>
  ): Promise<void> => {
    if (isCancelled() || depth > maxDepth || collected.length >= maxEntries) return
    const directoryKey = pathKey(path || root)
    if (seenDirectories.has(directoryKey)) return
    seenDirectories.add(directoryKey)
    const result = await listWorkspaceDirectory({ workspaceRoot: root, path: path || root })
    if (!result.ok) throw new Error(result.message)
    for (const entry of result.entries) {
      if (isCancelled() || collected.length >= maxEntries) return
      if (entry.type === 'directory') {
        if (!isChatFileTreeIgnoredDirectory(entry.name)) {
          await scanDirectory(entry.path, depth + 1, seenDirectories)
        }
        continue
      }
      if (isChatFileTreePreviewableEntry(entry)) collected.push(entry)
    }
  }

  await scanDirectory(root, 0, new Set())
  return sortRecentFiles(collected).slice(0, limit)
}

export function isChatFileTreeIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRS.has(name.toLowerCase())
}

export function isChatFileTreePreviewableEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'file' && isWorkspaceTextPreviewPath(entry.path || entry.name)
}

export function formatChatFileTreeUnsupportedMessage(name: string): string {
  return `${name} is not a supported text preview.`
}

export function ChatFileTreePanel({
  workspaceRoot,
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
  const [recentScan, setRecentScan] = useState<RecentScanState>({ entries: [], loading: false, error: null })
  const [recentScanNonce, setRecentScanNonce] = useState(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const root = workspaceRoot.trim()
  const rootName = useMemo(() => workspaceDisplayName(root), [root])

  useEffect(() => {
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
    setContextMenu(null)
    setRecentScan({ entries: [], loading: false, error: null })
  }, [root])

  const loadDirectory = useCallback((path: string): void => {
    if (!root || typeof window.kunGui?.listWorkspaceDirectory !== 'function') return
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
        workspaceRoot: root,
        path: path || root
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
  }, [root])

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
        const entries = await scanChatFileTreeRecentFiles(root, listWorkspaceDirectory, {
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
  }, [root, recentScanNonce])

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

  const selectedKey = useMemo(() => pathKey(selectedPath ?? ''), [selectedPath])
  const recentEntries = recentScan.entries

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
    setExpanded(new Set([ROOT_PATH]))
    setRecentScan((current) => ({
      entries: current.entries,
      loading: true,
      error: null
    }))
    setRecentScanNonce((value) => value + 1)
  }

  const addReference = (entry: WorkspaceEntry): void => {
    onAddReference(entryReference(entry, root))
    setContextMenu(null)
  }

  const setEntryDragData = (event: ReactDragEvent<HTMLElement>, entry: WorkspaceEntry): void => {
    const reference = entryReference(entry, root)
    const token = formatComposerFileMentionToken(reference.relativePath, reference.type === 'directory')
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', `${token} `)
    event.dataTransfer.setData('application/x-kun-file-reference', JSON.stringify(reference))
  }

  const copyEntryPath = async (entry: WorkspaceEntry, mode: 'absolute' | 'relative'): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    const value = mode === 'absolute' ? entry.path : relativeWorkspacePath(entry.path, root)
    await navigator.clipboard.writeText(value)
    setContextMenu(null)
  }

  const revealEntry = async (entry: WorkspaceEntry): Promise<void> => {
    if (typeof window.kunGui?.openEditorPath !== 'function') return
    await window.kunGui.openEditorPath({
      path: entry.path,
      workspaceRoot: root,
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

    return sortChatFileTreeEntries(state.entries, sortMode)
      .filter((entry) => entry.type !== 'directory' || !isChatFileTreeIgnoredDirectory(entry.name))
      .flatMap((entry) => {
        const isDirectory = entry.type === 'directory'
        const entryExpanded = expanded.has(entry.path)
        const previewable = isChatFileTreePreviewableEntry(entry)
        const active = !isDirectory && selectedKey === pathKey(entry.path)
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
                onPreviewFile(entry.path)
              }}
              onContextMenu={(event) => openContextMenu(event, entry)}
              buttonClassName="items-center gap-1.5 py-1.5 pr-1.5 text-[12.5px]"
              buttonStyle={{ paddingLeft: depth * 14 + 8 }}
              trailing={
                isDirectory ? (
                  entryExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  )
                ) : null
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
        label={rootName || t('fileTreeTitle')}
        title={root}
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
                onClick={() => onPreviewFile(entry.path)}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                title={entry.path}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 truncate">{relativeWorkspacePath(entry.path, root)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`${fill ? 'min-h-0 flex-1' : 'max-h-[34vh] min-h-[96px]'} overflow-y-auto overflow-x-hidden px-1`}>
        {renderDirectory(ROOT_PATH, 0)}
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
