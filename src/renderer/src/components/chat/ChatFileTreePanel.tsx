import type { WorkspaceEntry } from '@shared/workspace-file'
import { ArrowDownUp, ChevronRight, ChevronsDownUp, GitBranch, RefreshCw, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import type { TFunction } from 'i18next'
import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  formatComposerFileMentionToken,
  relativeWorkspacePath
} from '../../lib/composer-file-references'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import {
  chatFileTreeDisplayName,
  chatFileTreeEntryReference,
  chatFileTreePathKey,
  chatFileTreeUniqueRoots,
  isChatFileTreeDimmedDirectory,
  normalizeChatFileTreePath,
  owningChatFileTreeRoot,
  scanChatFileTreeRecentFilesInRoots,
  type ChatFileTreeReference,
  type FileTreeSortMode
} from './chat-file-tree-helpers'
import {
  buildChangedFileTreeRows,
  buildChatFileTreeRows,
  type ChatFileTreeDirectoryState,
  type ChatFileTreeRow
} from './chat-file-tree-rows'
import {
  ChatFileTreeContextMenu,
  ChatFileTreeEntryRow,
  ChatFileTreeSearchRow,
  ChatFileTreeStateRow,
  type ChatFileTreeMenuItem
} from './ChatFileTreeRowViews'
import { useWorkspaceFileSearch } from './use-workspace-file-search'
import { useWorkspaceGitStatus } from './use-workspace-git-status'

export type { ChatFileTreeReference } from './chat-file-tree-helpers'
export {
  chatFileTreeEntryMatchesQuery,
  compareChatFileTreeEntriesByModified,
  compareChatFileTreeEntriesByName,
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

type MenuTarget = { x: number; y: number; entry: WorkspaceEntry; root: string }
type RecentScanState = { entries: WorkspaceEntry[]; loading: boolean; error: string | null }

const RECENT_OPEN_KEY = 'kun.fileTree.recentOpen'
/** Expanded folders per set of roots, kept across remounts (the explorer overlay remounts the tree). */
const expansionMemory = new Map<string, string[]>()

function rememberedExpansion(rootsKey: string, multiRoot: boolean): Set<string> {
  return new Set(expansionMemory.get(rootsKey) ?? (multiRoot ? rootsKey.split('\n') : []))
}
const FOCUS_REFRESH_INTERVAL_MS = 5_000

export function formatChatFileTreeAge(mtimeMs: number | undefined, now: number, t: TFunction): string {
  if (!mtimeMs) return ''
  const minutes = Math.floor(Math.max(0, now - mtimeMs) / 60_000)
  if (minutes < 1) return t('fileTreeJustNow')
  if (minutes < 60) return t('fileTreeMinutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('fileTreeHoursAgo', { count: hours })
  return t('fileTreeDaysAgo', { count: Math.floor(hours / 24) })
}

export function ChatFileTreePanel({
  workspaceRoot,
  extraRoots = [],
  selectedPath,
  onPreviewFile,
  onAddReference,
  t,
  fill = false
}: Props): ReactElement | null {
  const roots = useMemo(() => chatFileTreeUniqueRoots(workspaceRoot, extraRoots), [workspaceRoot, extraRoots])
  const root = roots[0] ?? ''
  const multiRoot = roots.length > 1
  const rootsKey = roots.join('\n')
  const [expanded, setExpandedState] = useState<Set<string>>(() => rememberedExpansion(rootsKey, multiRoot))
  const [directories, setDirectories] = useState<Record<string, ChatFileTreeDirectoryState>>({})
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [sortMode, setSortMode] = useState<FileTreeSortMode>('name')
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [recentOpen, setRecentOpen] = useState(() => readBrowserStorageItem(RECENT_OPEN_KEY) !== 'false')
  const [recentScan, setRecentScan] = useState<RecentScanState>({ entries: [], loading: false, error: null })
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const directoriesRef = useRef(directories)
  directoriesRef.current = directories
  const lastFocusRefreshRef = useRef(0)
  const git = useWorkspaceGitStatus(roots, refreshNonce)
  const search = useWorkspaceFileSearch(roots, query, refreshNonce)
  const owningRoot = useCallback((path: string): string => owningChatFileTreeRoot(path, roots), [roots])

  useEffect(() => {
    setExpandedState(rememberedExpansion(rootsKey, multiRoot))
    setDirectories({})
    setMenu(null)
    setQuery('')
    setChangedOnly(false)
    setRecentScan({ entries: [], loading: false, error: null })
  }, [rootsKey, multiRoot])

  const loadDirectory = useCallback((directoryPath: string, keepEntries = false): void => {
    if (typeof window.kunGui?.listWorkspaceDirectory !== 'function') return
    setDirectories((current) => ({
      ...current,
      [directoryPath]: {
        entries: keepEntries ? current[directoryPath]?.entries ?? [] : [],
        loading: true,
        error: null
      }
    }))
    void window.kunGui
      .listWorkspaceDirectory({ workspaceRoot: owningChatFileTreeRoot(directoryPath, roots) || root, path: directoryPath })
      .then((result) => {
        setDirectories((current) => ({
          ...current,
          [directoryPath]: result.ok
            ? { entries: result.entries, loading: false, error: null }
            : { entries: [], loading: false, error: result.message }
        }))
      })
      .catch((error) => {
        setDirectories((current) => ({
          ...current,
          [directoryPath]: { entries: [], loading: false, error: error instanceof Error ? error.message : String(error) }
        }))
      })
  }, [root, roots])

  const { rows, missing } = useMemo(
    () => buildChatFileTreeRows({ roots, directories, expanded, sortMode }),
    [directories, expanded, roots, sortMode]
  )

  useEffect(() => {
    for (const path of missing) {
      if (!directoriesRef.current[path]) loadDirectory(path)
    }
  }, [loadDirectory, missing])

  useEffect(() => {
    if (typeof window.addEventListener !== 'function') return
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_INTERVAL_MS) return
      lastFocusRefreshRef.current = now
      for (const path of Object.keys(directoriesRef.current)) loadDirectory(path, true)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadDirectory])

  useEffect(() => {
    const list = window.kunGui?.listWorkspaceDirectory?.bind(window.kunGui)
    if (!rootsKey || !recentOpen || typeof list !== 'function') return
    let cancelled = false
    setRecentScan((current) => ({ ...current, loading: true, error: null }))
    void scanChatFileTreeRecentFilesInRoots(rootsKey.split('\n'), list, { isCancelled: () => cancelled })
      .then((entries) => {
        if (!cancelled) setRecentScan({ entries, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled) setRecentScan({ entries: [], loading: false, error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [recentOpen, refreshNonce, rootsKey])

  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const changedRows = useMemo(
    () => (changedOnly ? buildChangedFileTreeRows(git.changed, roots) : []),
    [changedOnly, git.changed, roots]
  )

  if (!root) return null

  const selectedKey = chatFileTreePathKey(selectedPath ?? '')
  const searching = query.trim().length > 0
  const visibleRows: ChatFileTreeRow[] = changedOnly ? changedRows : rows
  const rowKeys = searching
    ? search.hits.map((hit) => hit.path)
    : visibleRows.flatMap((row) => (row.kind === 'entry' ? [row.key] : []))
  const focusableKey = rowKeys.find((key) => key === focusKey) ??
    rowKeys.find((key) => chatFileTreePathKey(key) === selectedKey) ?? rowKeys[0]

  const setExpanded = (update: (current: Set<string>) => Set<string>): void => {
    setExpandedState((current) => {
      const next = update(current)
      expansionMemory.set(rootsKey, [...next])
      return next
    })
  }

  const toggleDirectory = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** Leaves the changed-files view with the folder and its parents expanded. */
  const revealInTree = (path: string, entryRoot: string): void => {
    const rootPath = normalizeChatFileTreePath(entryRoot)
    const segments = normalizeChatFileTreePath(path).slice(rootPath.length).split('/').filter(Boolean)
    const separator = entryRoot.includes('\\') && !entryRoot.includes('/') ? '\\' : '/'
    setExpanded((current) => {
      const next = new Set(current)
      let cursor = entryRoot.replace(/[\\/]+$/, '')
      for (const segment of segments) {
        cursor = `${cursor}${separator}${segment}`
        next.add(cursor)
      }
      return next
    })
    setChangedOnly(false)
  }

  const refresh = (): void => {
    setDirectories({})
    setRefreshNonce((value) => value + 1)
  }

  const setRecent = (open: boolean): void => {
    setRecentOpen(open)
    writeBrowserStorageItem(RECENT_OPEN_KEY, open ? 'true' : 'false')
  }

  const dragData = (event: ReactDragEvent<HTMLElement>, entry: WorkspaceEntry, entryRoot: string): void => {
    const reference = chatFileTreeEntryReference(entry, entryRoot)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', `${formatComposerFileMentionToken(reference.relativePath, reference.type === 'directory')} `)
    event.dataTransfer.setData(COMPOSER_FILE_REFERENCE_DRAG_MIME, JSON.stringify(reference))
  }

  const openMenu = (event: ReactMouseEvent<HTMLElement>, entry: WorkspaceEntry, entryRoot: string): void => {
    event.preventDefault()
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
      entry,
      root: entryRoot
    })
  }

  const menuItems = (target: MenuTarget): ChatFileTreeMenuItem[] => {
    const { entry, root: entryRoot } = target
    const isFile = entry.type === 'file'
    const run = (action: () => unknown) => () => {
      setMenu(null)
      void Promise.resolve(action()).catch(() => undefined)
    }
    const copy = (value: string) => run(() => navigator.clipboard?.writeText?.(value))
    const items: ChatFileTreeMenuItem[] = []
    if (isFile) items.push({ kind: 'item', label: t('fileTreeOpenFile'), shortcut: '↵', onSelect: run(() => onPreviewFile(entry.path, entryRoot)) })
    items.push(
      {
        kind: 'item',
        label: isFile ? t('fileTreeAddFileReference') : t('fileTreeAddFolderReference'),
        shortcut: '⌘↵',
        onSelect: run(() => onAddReference(chatFileTreeEntryReference(entry, entryRoot)))
      },
      { kind: 'separator' },
      { kind: 'item', label: t('filePreviewOpenEditor'), onSelect: run(() => openWorkspacePathInEditor({ path: entry.path }, entryRoot)) }
    )
    if (isFile) {
      items.push({
        kind: 'item',
        label: t('filePreviewOpenSystem'),
        onSelect: run(() => window.kunGui?.openWorkspaceFileInSystem?.({ path: entry.path, workspaceRoot: entryRoot }))
      })
    }
    items.push(
      {
        kind: 'item',
        label: window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager'),
        onSelect: run(() => window.kunGui?.openEditorPath?.({ path: entry.path, workspaceRoot: entryRoot, editorId: 'file-manager' }))
      },
      { kind: 'separator' },
      { kind: 'item', label: t('fileTreeCopyAbsolutePath'), onSelect: copy(entry.path) },
      { kind: 'item', label: t('fileTreeCopyRelativePath'), onSelect: copy(relativeWorkspacePath(entry.path, entryRoot)) }
    )
    return items
  }

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tree-row]')]
    const current = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[data-tree-row]') : null
    const index = current ? items.indexOf(current) : -1
    if (index < 0) return
    const focusAt = (next: number): void => {
      const item = items[Math.max(0, Math.min(items.length - 1, next))]
      if (!item) return
      event.preventDefault()
      item.focus()
      setFocusKey(item.dataset.treeRow ?? null)
    }
    const isDirectory = current?.dataset.treeDir === 'true'
    const isOpen = current?.getAttribute('aria-expanded') === 'true'
    if (event.key === 'ArrowDown') focusAt(index + 1)
    else if (event.key === 'ArrowUp') focusAt(index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(items.length - 1)
    else if (event.key === 'ArrowRight' && isDirectory) {
      event.preventDefault()
      if (isOpen) focusAt(index + 1)
      else current?.click()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (isDirectory && isOpen) current?.click()
      else {
        const parent = items.findIndex((item) => item.dataset.treeRow === current?.dataset.treeParent)
        if (parent >= 0) focusAt(parent)
      }
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && current?.dataset.treeRow) {
      event.preventDefault()
      const path = current.dataset.treeRow
      const entryRoot = owningRoot(path) || root
      onAddReference(chatFileTreeEntryReference({
        name: chatFileTreeDisplayName(path), path, type: isDirectory ? 'directory' : 'file', ext: ''
      }, entryRoot))
    }
  }

  const renderRow = (row: ChatFileTreeRow): ReactElement => {
    if (row.kind !== 'entry') {
      return (
        <ChatFileTreeStateRow
          key={row.key}
          kind={row.kind}
          depth={row.depth}
          message={row.kind === 'error' ? row.message : undefined}
          onRetry={row.kind === 'error' ? () => loadDirectory(row.retryPath) : undefined}
          t={t}
        />
      )
    }
    const isDirectory = row.entry.type === 'directory'
    return (
      <ChatFileTreeEntryRow
        key={row.key}
        path={row.entry.path}
        labels={row.labels}
        depth={row.depth}
        isDirectory={isDirectory}
        open={row.open}
        selected={!isDirectory && chatFileTreePathKey(row.entry.path) === selectedKey}
        focusable={row.key === focusableKey}
        dimmed={isDirectory && isChatFileTreeDimmedDirectory(row.entry.name)}
        gitStatus={git.statusFor(row.entry.path)}
        containsChanges={isDirectory && git.hasChangesUnder(row.contentPath)}
        parentKey={row.parentKey}
        onActivate={() => {
          setFocusKey(row.key)
          if (!isDirectory) onPreviewFile(row.entry.path, row.root)
          else if (!changedOnly) toggleDirectory(row.togglePath)
          else if (!row.open) revealInTree(row.entry.path, row.root)
        }}
        onContextMenu={(event) => openMenu(event, row.entry, row.root)}
        onDragStart={(event) => dragData(event, row.entry, row.root)}
      />
    )
  }

  const changedCount = git.changed.length
  const recentNow = Date.now()

  return (
    <div className={`ds-no-drag flex min-h-0 flex-col ${fill ? 'h-full' : ''}`}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 pl-3 pr-1.5">
        <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink" title={roots.join('\n')}>
          {multiRoot ? t('fileTreeTitle') : chatFileTreeDisplayName(root)}
        </span>
        {git.branch ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-ds-muted" title={git.branch}>
            <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{git.branch}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        {git.available ? (
          <button
            type="button"
            aria-pressed={changedOnly}
            onClick={() => setChangedOnly((value) => !value)}
            title={t('fileTreeChangedOnly')}
            className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border px-2 text-[11.5px] font-semibold transition ${
              changedOnly
                ? 'border-[color:var(--ds-git-modified)] bg-[var(--ds-file-preview-warning-bg)] text-[color:var(--ds-file-preview-warning-ink)]'
                : 'border-ds-border bg-ds-card text-ds-muted hover:text-ds-ink'
            }`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--ds-git-modified)]" />
            {t('fileTreeChangedCount', { count: changedCount })}
          </button>
        ) : null}
        <SidebarIconButton
          title={sortMode === 'modified' ? t('fileTreeSortByName') : t('fileTreeSortByModifiedTime')}
          ariaLabel={sortMode === 'modified' ? t('fileTreeSortByName') : t('fileTreeSortByModifiedTime')}
          active={sortMode === 'modified'}
          onClick={() => setSortMode((mode) => (mode === 'modified' ? 'name' : 'modified'))}
        >
          <ArrowDownUp className="h-3.5 w-3.5" strokeWidth={1.8} />
        </SidebarIconButton>
        <SidebarIconButton title={t('fileTreeCollapseAll')} ariaLabel={t('fileTreeCollapseAll')} onClick={() => setExpanded(() => new Set())}>
          <ChevronsDownUp className="h-3.5 w-3.5" strokeWidth={1.8} />
        </SidebarIconButton>
        <SidebarIconButton title={t('fileTreeRefresh')} ariaLabel={t('fileTreeRefresh')} onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        </SidebarIconButton>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <label className="flex h-[30px] items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 transition focus-within:border-accent/45">
          <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('fileTreeSearchWorkspace')}
            aria-label={t('fileTreeSearchWorkspace')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('fileTreeClearSearch')}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </label>
      </div>
      <div
        role="tree"
        aria-label={multiRoot ? t('fileTreeTitle') : chatFileTreeDisplayName(root)}
        onKeyDown={onTreeKeyDown}
        className={`${fill ? 'min-h-0 flex-1' : 'max-h-[34vh] min-h-[96px]'} flex flex-col gap-px overflow-y-auto overflow-x-hidden px-1.5 pb-3`}
      >
        {searching ? (
          <>
            <div className="px-2 pb-1 text-[11.5px] text-ds-muted">
              {search.loading && !search.hits.length ? t('fileTreeSearching') : t('fileTreeSearchResults', { count: search.hits.length })}
            </div>
            {search.hits.map((hit) => (
              <ChatFileTreeSearchRow
                key={hit.path}
                hit={hit}
                selected={chatFileTreePathKey(hit.path) === selectedKey}
                focusable={hit.path === focusableKey}
                rootLabel={t('fileTreeWorkspaceRoot')}
                onActivate={() => {
                  setFocusKey(hit.path)
                  onPreviewFile(hit.path, hit.root || owningRoot(hit.path) || root)
                }}
                onContextMenu={(event) => openMenu(event, { name: hit.name, path: hit.path, type: 'file', ext: '' }, hit.root || root)}
                onDragStart={(event) => dragData(event, { name: hit.name, path: hit.path, type: 'file', ext: '' }, hit.root || root)}
              />
            ))}
            {!search.loading && !search.hits.length ? (
              <div className="px-2 py-3 text-[12.5px] text-ds-muted">{t('fileTreeNoResults')}</div>
            ) : null}
          </>
        ) : changedOnly ? (
          changedRows.length ? changedRows.map(renderRow) : (
            <div className="px-2 py-3 text-[12.5px] text-ds-muted">{t('fileTreeNoChanges')}</div>
          )
        ) : (
          <>
            <button
              type="button"
              aria-expanded={recentOpen}
              onClick={() => setRecent(!recentOpen)}
              className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-left text-[11.5px] font-semibold text-ds-muted transition hover:bg-ds-hover"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${recentOpen ? 'rotate-90' : ''}`} strokeWidth={2} />
              {t('fileTreeRecentModifiedFiles')}
            </button>
            {recentOpen ? (
              recentScan.loading && !recentScan.entries.length ? (
                <ChatFileTreeStateRow kind="loading" depth={1} t={t} />
              ) : recentScan.entries.map((entry) => {
                const entryRoot = owningRoot(entry.path) || root
                return (
                  <ChatFileTreeEntryRow
                    key={`recent-${entry.path}`}
                    path={entry.path}
                    labels={[entry.name]}
                    depth={1}
                    isDirectory={false}
                    open={false}
                    selected={false}
                    focusable={false}
                    dimmed={false}
                    gitStatus={git.statusFor(entry.path)}
                    containsChanges={false}
                    meta={formatChatFileTreeAge(entry.mtimeMs, recentNow, t)}
                    parentKey={null}
                    onActivate={() => onPreviewFile(entry.path, entryRoot)}
                    onContextMenu={(event) => openMenu(event, entry, entryRoot)}
                    onDragStart={(event) => dragData(event, entry, entryRoot)}
                  />
                )
              })
            ) : null}
            <div aria-hidden="true" className="mx-2 my-1.5 h-px shrink-0 bg-ds-border-muted" />
            {rows.map(renderRow)}
          </>
        )}
      </div>
      {menu ? (
        <ChatFileTreeContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.entry.name}
          items={menuItems(menu)}
          menuRef={menuRef}
        />
      ) : null}
    </div>
  )
}
