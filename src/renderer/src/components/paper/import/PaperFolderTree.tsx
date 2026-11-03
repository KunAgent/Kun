import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Check, ChevronRight, Folder, FolderOpen, FolderPlus, Library, Loader2, Plus, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../../write/write-workspace-store'
import { ancestorFolders, buildFolderRows } from '../../../paper/paper-folder-tree'
import { MAX_FOLDER_DEPTH, createPaperFolder, joinPaperFolder } from '../../../paper/paper-import-target'
import { usePaperModeStore } from '../../../paper/paper-mode-store'

const INDENT = 16
/** Show the filter box once the library has this many folders. */
const SEARCH_FROM = 8

/** Where the library lives on disk: the papers dir and `<space> / <papers dir>`. */
export function usePaperLibraryLocation(): { papersDir: string; location: string } {
  const { t } = useTranslation('common')
  const root = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const defaultRoot = useWriteWorkspaceStore((s) => s.defaultWorkspaceRoot)
  const configured = useWriteWorkspaceStore((s) => s.paperReading.papersDir)
  const papersDir = (configured || 'papers').replace(/^\/+|\/+$/g, '')
  const space = root === defaultRoot ? t('writeDefaultSpace') : writeBasenameFromPath(root)
  return { papersDir, location: `${space} / ${papersDir}` }
}

function NewFolderRow({
  parent,
  depth,
  onDone
}: {
  parent: string
  depth: number
  /** `created` is the new folder's path, or undefined when canceled. */
  onDone: (created?: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const groups = usePaperModeStore((s) => s.groups)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) {
      onDone()
      return
    }
    const target = joinPaperFolder(parent, name)
    if (!target) {
      setError(t('paperImportFolderInvalid'))
      return
    }
    if (groups.includes(target)) {
      onDone(target)
      return
    }
    setBusy(true)
    const result = await createPaperFolder(target)
    setBusy(false)
    if (result.ok) onDone(result.folder)
    else setError(result.message === 'invalid' ? t('paperImportFolderInvalid') : result.message)
  }

  return (
    <div role="none" style={{ paddingLeft: 24 + depth * INDENT }} className="py-0.5 pr-1">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className={`flex h-8 items-center gap-1.5 rounded-md border bg-ds-main px-2 ${error ? 'border-red-400' : 'border-[var(--ds-accent)]'}`}
      >
        {busy
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" />
          : <FolderPlus className="h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]" strokeWidth={1.8} />}
        <input
          autoFocus
          value={name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            onDone()
          }}
          placeholder={t('paperImportFolderNewPlaceholder')}
          aria-label={t('paperImportFolderNew')}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-label={t('paperImportFolderCreate')}
          title={t('paperImportFolderCreate')}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--ds-accent)] transition hover:bg-ds-hover disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          onClick={() => onDone()}
          aria-label={t('close')}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </form>
      {error ? <p className="px-0.5 pt-1 text-[11px] leading-4 text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  )
}

/**
 * The library's folders as a real directory tree: the papers dir on top,
 * nested folders under it with their paper counts. Selecting a row picks that
 * folder; with `creatingIn` set, a name field opens inside that folder so new
 * folders are made exactly where they will live.
 */
export function PaperFolderTree({
  value,
  onChange,
  creatingIn = null,
  onCreatingChange,
  onCreated,
  maxHeight = 260
}: {
  value: string
  onChange: (folder: string) => void
  /** Folder that currently shows the inline "new folder" field (null: none). */
  creatingIn?: string | null
  /** Omit to make the tree read-only (no create affordances). */
  onCreatingChange?: (parent: string | null) => void
  /** A folder was created on disk from the inline field. */
  onCreated?: (folder: string) => void
  maxHeight?: number
}): ReactElement {
  const { t } = useTranslation('common')
  const groups = usePaperModeStore((s) => s.groups)
  const entries = usePaperModeStore((s) => s.entries)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(ancestorFolders(value)))
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const { papersDir, location } = usePaperLibraryLocation()
  const canCreate = Boolean(onCreatingChange)

  // The chosen folder (and the one being created in) always stays visible.
  useEffect(() => {
    const open = [...ancestorFolders(value), ...(creatingIn ? [creatingIn] : [])]
    if (!open.length) return
    setExpanded((current) => (open.every((folder) => current.has(folder)) ? current : new Set([...current, ...open])))
  }, [value, creatingIn])

  const rows = useMemo(
    () => buildFolderRows({ groups, entryGroups: entries.map((entry) => entry.group), expanded, query }),
    [groups, entries, expanded, query]
  )
  const searching = query.trim() !== ''
  const showSearch = groups.length >= SEARCH_FROM || searching

  const toggle = (folder: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (!target.matches('[data-folder-row]')) return
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-folder-row]') ?? [])]
    const index = items.indexOf(target)
    const folder = target.dataset.folderRow ?? ''
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      items[Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    } else if (event.key === 'ArrowRight' && folder && !expanded.has(folder)) {
      event.preventDefault()
      toggle(folder)
    } else if (event.key === 'ArrowLeft' && folder && expanded.has(folder)) {
      event.preventDefault()
      toggle(folder)
    }
  }

  const rowBase = 'flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[12.5px] transition'
  const rowState = (active: boolean): string =>
    active ? 'bg-[var(--ds-accent-soft)] font-medium text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'
  const check = (active: boolean): ReactElement => (
    <Check className={`h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)] ${active ? '' : 'invisible'}`} strokeWidth={2} />
  )
  const finishCreate = (created?: string): void => {
    onCreatingChange?.(null)
    if (created) onCreated?.(created)
  }
  const creatingDepth = (parent: string): number => (parent ? parent.split('/').length : 0)

  return (
    <div>
      {showSearch ? (
        <label className="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-main px-2.5 focus-within:border-[var(--ds-accent)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('paperImportSheetSearchFolder')}
            aria-label={t('paperImportSheetSearchFolder')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none focus-visible:outline-none placeholder:text-ds-faint"
          />
        </label>
      ) : null}
      <div
        ref={listRef}
        role="tree"
        aria-label={t('paperImportFolderTitle')}
        onKeyDown={onKeyDown}
        style={{ maxHeight }}
        className="overflow-y-auto"
      >
        {!searching ? (
          <div className="group/row relative" role="none">
            <button
              type="button"
              role="treeitem"
              aria-level={1}
              aria-selected={!value}
              data-folder-row=""
              title={location}
              onClick={() => onChange('')}
              className={`${rowBase} pl-2 ${rowState(!value)}`}
            >
              <Library className="h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">
                {t('paperImportFolderRoot')}
                <span className="ml-1.5 text-[11px] font-normal text-ds-faint">{papersDir}/</span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ds-faint group-hover/row:invisible">{entries.length}</span>
              {check(!value)}
            </button>
            {canCreate ? (
              <button
                type="button"
                onClick={() => onCreatingChange?.('')}
                title={t('paperFolderNewInside')}
                aria-label={t('paperFolderNewInside')}
                className="absolute right-[30px] top-1.5 hidden h-5 w-5 items-center justify-center rounded text-ds-muted transition hover:bg-ds-main hover:text-ds-ink group-hover/row:flex"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
          </div>
        ) : null}
        {canCreate && creatingIn === '' && !searching ? <NewFolderRow parent="" depth={0} onDone={finishCreate} /> : null}
        {rows.map((row) => {
          const active = value === row.folder
          return (
            <div key={row.folder} role="none">
              <div className="group/row relative" role="none">
                <button
                  type="button"
                  role="treeitem"
                  aria-level={row.depth + 2}
                  aria-selected={active}
                  aria-expanded={row.hasChildren && !searching ? row.expanded : undefined}
                  data-folder-row={row.folder}
                  title={row.folder}
                  onClick={() => onChange(row.folder)}
                  style={{ paddingLeft: 24 + row.depth * INDENT }}
                  className={`${rowBase} ${rowState(active)}`}
                >
                  {row.expanded && row.hasChildren && !searching
                    ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
                    : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />}
                  <span className="min-w-0 flex-1 truncate">{searching ? row.folder : row.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ds-faint group-hover/row:invisible">{row.total}</span>
                  {check(active)}
                </button>
                {row.hasChildren && !searching ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => toggle(row.folder)}
                    aria-hidden="true"
                    style={{ left: 6 + row.depth * INDENT }}
                    className="absolute top-1.5 grid h-5 w-4 place-items-center rounded text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${row.expanded ? 'rotate-90' : ''}`} strokeWidth={2} />
                  </button>
                ) : null}
                {canCreate && row.depth + 1 < MAX_FOLDER_DEPTH ? (
                  <button
                    type="button"
                    onClick={() => onCreatingChange?.(row.folder)}
                    title={t('paperFolderNewInside')}
                    aria-label={t('paperFolderNewInside')}
                    className="absolute right-[30px] top-1.5 hidden h-5 w-5 items-center justify-center rounded text-ds-muted transition hover:bg-ds-main hover:text-ds-ink group-hover/row:flex"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
              {canCreate && creatingIn === row.folder && !searching ? (
                <NewFolderRow parent={row.folder} depth={creatingDepth(row.folder)} onDone={finishCreate} />
              ) : null}
            </div>
          )
        })}
        {!rows.length ? (
          <p className="px-2 py-3 text-center text-[12px] text-ds-faint">
            {searching ? t('paperImportSheetNoFolder') : t('paperFolderTreeEmpty')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
