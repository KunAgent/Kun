import type { GitFileStatusCode } from '@shared/git-file-status'
import { ChevronRight } from 'lucide-react'
import {
  Fragment,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type RefObject
} from 'react'
import { FileTypeIcon, FolderTypeIcon } from '../FileTypeIcon'
import { CHAT_FILE_TREE_INDENT, type ChatFileTreeSearchHit } from './chat-file-tree-rows'

type Translate = (key: string, values?: Record<string, unknown>) => string

const GIT_LETTER: Record<GitFileStatusCode, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
  ignored: ''
}

const ROW_START_PADDING = 6

function guides(depth: number): ReactElement[] {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      aria-hidden="true"
      className="ds-file-tree-guide"
      style={{ left: level * CHAT_FILE_TREE_INDENT + ROW_START_PADDING + 6 }}
    />
  ))
}

type EntryRowProps = {
  path: string
  labels: string[]
  depth: number
  isDirectory: boolean
  open: boolean
  selected: boolean
  focusable: boolean
  dimmed: boolean
  gitStatus: GitFileStatusCode | null
  containsChanges: boolean
  meta?: string
  parentKey: string | null
  onActivate: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void
}

export function ChatFileTreeEntryRow({
  path,
  labels,
  depth,
  isDirectory,
  open,
  selected,
  focusable,
  dimmed,
  gitStatus,
  containsChanges,
  meta,
  parentKey,
  onActivate,
  onContextMenu,
  onDragStart
}: EntryRowProps): ReactElement {
  const visibleStatus = gitStatus && gitStatus !== 'ignored' ? gitStatus : null
  return (
    <button
      type="button"
      role="treeitem"
      draggable
      data-tree-row={path}
      data-tree-parent={parentKey ?? undefined}
      data-tree-dir={isDirectory ? 'true' : undefined}
      data-git={visibleStatus ?? undefined}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={isDirectory ? open : undefined}
      tabIndex={focusable ? 0 : -1}
      title={path}
      className={`ds-file-tree-row ${dimmed || gitStatus === 'ignored' ? 'is-ignored' : ''}`}
      style={{ paddingLeft: depth * CHAT_FILE_TREE_INDENT + ROW_START_PADDING }}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
    >
      {guides(depth)}
      <span aria-hidden="true" className={`ds-file-tree-chevron ${open ? 'is-open' : ''}`}>
        {isDirectory ? <ChevronRight className="h-3 w-3" strokeWidth={2} /> : null}
      </span>
      {isDirectory ? <FolderTypeIcon open={open} /> : <FileTypeIcon path={path} />}
      <span className="ds-file-tree-name">
        {labels.map((label, index) => (
          <Fragment key={`${label}-${index}`}>
            {index > 0 ? <span className="ds-file-tree-name-separator"> / </span> : null}
            {label}
          </Fragment>
        ))}
      </span>
      {meta ? <span className="ds-file-tree-meta">{meta}</span> : null}
      {isDirectory && containsChanges && !open ? <span aria-hidden="true" className="ds-file-tree-dot" /> : null}
      {visibleStatus && GIT_LETTER[visibleStatus] ? <span className="ds-file-tree-git">{GIT_LETTER[visibleStatus]}</span> : null}
    </button>
  )
}

type StateRowProps = {
  kind: 'loading' | 'empty' | 'error'
  depth: number
  message?: string
  onRetry?: () => void
  t: Translate
}

export function ChatFileTreeStateRow({ kind, depth, message, onRetry, t }: StateRowProps): ReactElement {
  const paddingLeft = depth * CHAT_FILE_TREE_INDENT + ROW_START_PADDING + 18
  if (kind === 'loading') {
    return (
      <div aria-busy="true" className="flex h-[26px] shrink-0 items-center gap-2" style={{ paddingLeft }}>
        <span className="ds-file-tree-skeleton" style={{ width: 14, height: 14, borderRadius: 4 }} />
        <span className="ds-file-tree-skeleton" style={{ width: 96 + (depth % 3) * 24 }} />
        <span className="sr-only">{t('fileTreeLoading')}</span>
      </div>
    )
  }
  if (kind === 'empty') {
    return (
      <div className="flex h-[26px] shrink-0 items-center text-[12px] text-ds-muted" style={{ paddingLeft }}>
        {t('fileTreeEmptyFolder')}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 py-1 pr-2 text-[12px] leading-[18px]" style={{ paddingLeft }}>
      <span className="min-w-0 flex-1 text-red-700 dark:text-red-300" title={message}>
        {t('fileTreeReadFailed', { message })}
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="ds-file-preview-button is-small">
          {t('fileTreeRetry')}
        </button>
      ) : null}
    </div>
  )
}

type SearchRowProps = {
  hit: ChatFileTreeSearchHit
  selected: boolean
  focusable: boolean
  rootLabel: string
  onActivate: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void
}

export function ChatFileTreeSearchRow({
  hit,
  selected,
  focusable,
  rootLabel,
  onActivate,
  onContextMenu,
  onDragStart
}: SearchRowProps): ReactElement {
  const [start, end] = hit.match ?? [0, 0]
  return (
    <button
      type="button"
      role="treeitem"
      draggable
      data-tree-row={hit.path}
      aria-level={1}
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      title={hit.path}
      className="ds-file-tree-row is-tall"
      style={{ paddingLeft: 10 }}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
    >
      <FileTypeIcon path={hit.path} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="ds-file-tree-name">
          {hit.match ? (
            <>
              {hit.name.slice(0, start)}
              <span className="ds-file-tree-hit">{hit.name.slice(start, end)}</span>
              {hit.name.slice(end)}
            </>
          ) : hit.name}
        </span>
        <span className="truncate text-[11px] leading-[15px] text-ds-muted">{hit.relativeDirectory || rootLabel}</span>
      </span>
    </button>
  )
}

export type ChatFileTreeMenuItem =
  | { kind: 'item'; label: string; shortcut?: string; onSelect: () => void }
  | { kind: 'separator' }

type MenuProps = {
  x: number
  y: number
  label: string
  items: ChatFileTreeMenuItem[]
  menuRef: RefObject<HTMLDivElement | null>
}

export function ChatFileTreeContextMenu({ x, y, label, items, menuRef }: MenuProps): ReactElement {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-[208px] rounded-[10px] border border-ds-border bg-ds-card p-[5px] shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => item.kind === 'separator' ? (
        <div key={`separator-${index}`} role="separator" className="mx-1.5 my-1 h-px bg-ds-border-muted" />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.onSelect}
          className="flex h-7 w-full items-center gap-3 rounded-md px-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:bg-ds-hover focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut ? <span className="text-[11px] text-ds-muted">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>
  )
}
