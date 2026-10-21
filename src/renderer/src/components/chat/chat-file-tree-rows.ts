import type { GitFileStatusCode, GitFileStatusEntry } from '@shared/git-file-status'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  chatFileTreeDisplayName,
  chatFileTreePathKey,
  isChatFileTreeHiddenDirectory,
  normalizeChatFileTreePath,
  owningChatFileTreeRoot,
  sortChatFileTreeEntries,
  type FileTreeSortMode
} from './chat-file-tree-helpers'

export const CHAT_FILE_TREE_INDENT = 14

export type ChatFileTreeDirectoryState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

export type ChatFileTreeRow =
  | {
      kind: 'entry'
      key: string
      entry: WorkspaceEntry
      /** Folder names joined into one row when a folder holds a single folder. */
      labels: string[]
      depth: number
      open: boolean
      /** The path whose expansion this row toggles (the head of a compact chain). */
      togglePath: string
      /** The deepest folder of a compact chain; its children follow the row. */
      contentPath: string
      parentKey: string | null
      root: string
    }
  | { kind: 'loading' | 'empty'; key: string; depth: number }
  | { kind: 'error'; key: string; depth: number; message: string; retryPath: string }

type BuildInput = {
  roots: readonly string[]
  directories: Readonly<Record<string, ChatFileTreeDirectoryState>>
  expanded: ReadonlySet<string>
  sortMode: FileTreeSortMode
}

function visibleEntries(state: ChatFileTreeDirectoryState, sortMode: FileTreeSortMode): WorkspaceEntry[] {
  return sortChatFileTreeEntries(
    state.entries.filter((entry) => entry.type !== 'directory' || !isChatFileTreeHiddenDirectory(entry.name)),
    sortMode
  )
}

/**
 * Flattens the lazily loaded tree into rows. Also returns the folders that
 * must be listed next: expanded folders and the tails of compact chains.
 */
export function buildChatFileTreeRows({ roots, directories, expanded, sortMode }: BuildInput): {
  rows: ChatFileTreeRow[]
  missing: string[]
} {
  const rows: ChatFileTreeRow[] = []
  const missing: string[] = []
  const multiRoot = roots.length > 1

  const children = (directoryPath: string, depth: number, parentKey: string | null, root: string): void => {
    const state = directories[directoryPath]
    if (!state) {
      missing.push(directoryPath)
      rows.push({ kind: 'loading', key: `${directoryPath}\0loading`, depth })
      return
    }
    if (state.loading && state.entries.length === 0) {
      rows.push({ kind: 'loading', key: `${directoryPath}\0loading`, depth })
      return
    }
    if (state.error) {
      rows.push({ kind: 'error', key: `${directoryPath}\0error`, depth, message: state.error, retryPath: directoryPath })
      return
    }
    const entries = visibleEntries(state, sortMode)
    if (entries.length === 0) {
      rows.push({ kind: 'empty', key: `${directoryPath}\0empty`, depth })
      return
    }
    for (const entry of entries) {
      if (entry.type !== 'directory') {
        rows.push({
          kind: 'entry', key: entry.path, entry, labels: [entry.name], depth, open: false,
          togglePath: entry.path, contentPath: entry.path, parentKey, root
        })
        continue
      }
      const open = expanded.has(entry.path)
      const labels = [entry.name]
      let tail = entry
      while (open) {
        const tailState = directories[tail.path]
        if (!tailState) {
          missing.push(tail.path)
          break
        }
        if (tailState.loading || tailState.error) break
        const only = visibleEntries(tailState, sortMode)
        if (only.length !== 1 || only[0].type !== 'directory') break
        tail = only[0]
        labels.push(tail.name)
      }
      rows.push({
        kind: 'entry', key: entry.path, entry, labels, depth, open,
        togglePath: entry.path, contentPath: tail.path, parentKey, root
      })
      if (open) children(tail.path, depth + 1, entry.path, root)
    }
  }

  for (const root of roots) {
    if (!multiRoot) {
      children(root, 0, null, root)
      continue
    }
    const open = expanded.has(root)
    rows.push({
      kind: 'entry',
      key: root,
      entry: { name: chatFileTreeDisplayName(root), path: root, type: 'directory', ext: '' },
      labels: [chatFileTreeDisplayName(root)],
      depth: 0,
      open,
      togglePath: root,
      contentPath: root,
      parentKey: null,
      root
    })
    if (open) children(root, 1, root, root)
  }
  return { rows, missing: [...new Set(missing)] }
}

type ChangedNode = {
  name: string
  path: string
  status?: GitFileStatusCode
  directory: boolean
  children: Map<string, ChangedNode>
}

/** Builds fully expanded rows for the "changed files only" view from git status entries. */
export function buildChangedFileTreeRows(
  entries: readonly GitFileStatusEntry[],
  roots: readonly string[]
): ChatFileTreeRow[] {
  const multiRoot = roots.length > 1
  const tops = new Map<string, ChangedNode>()
  for (const root of roots) {
    tops.set(root, { name: chatFileTreeDisplayName(root), path: root, directory: true, children: new Map() })
  }
  for (const item of entries) {
    if (item.status === 'ignored') continue
    const root = owningChatFileTreeRoot(item.path, roots)
    const top = tops.get(root)
    if (!top) continue
    const relative = normalizeChatFileTreePath(item.path).slice(normalizeChatFileTreePath(root).length).replace(/^\/+/, '')
    const segments = relative.split('/').filter(Boolean)
    let node = top
    let currentPath = normalizeChatFileTreePath(root)
    segments.forEach((segment, index) => {
      currentPath = `${currentPath}/${segment}`
      const last = index === segments.length - 1
      let next = node.children.get(segment)
      if (!next) {
        next = { name: segment, path: currentPath, directory: !last || Boolean(item.directory), children: new Map() }
        node.children.set(segment, next)
      }
      if (last) next.status = item.status
      node = next
    })
  }

  const rows: ChatFileTreeRow[] = []
  const walk = (node: ChangedNode, depth: number, parentKey: string | null, root: string): void => {
    const sorted = [...node.children.values()].sort((left, right) => {
      if (left.directory !== right.directory) return left.directory ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const child of sorted) {
      // Git reports a wholly untracked folder once; it stays a closed folder row.
      const open = child.directory && child.children.size > 0
      rows.push({
        kind: 'entry',
        key: child.path,
        entry: { name: child.name, path: child.path, type: child.directory ? 'directory' : 'file', ext: '' },
        labels: [child.name],
        depth,
        open,
        togglePath: child.path,
        contentPath: child.path,
        parentKey,
        root
      })
      if (open) walk(child, depth + 1, child.path, root)
    }
  }
  for (const [root, top] of tops) {
    if (top.children.size === 0) continue
    if (multiRoot) {
      rows.push({
        kind: 'entry', key: root, entry: { name: top.name, path: root, type: 'directory', ext: '' },
        labels: [top.name], depth: 0, open: true, togglePath: root, contentPath: root, parentKey: null, root
      })
    }
    walk(top, multiRoot ? 1 : 0, multiRoot ? root : null, root)
  }
  return rows
}

export type ChatFileTreeSearchHit = {
  path: string
  name: string
  relativeDirectory: string
  root: string
  /** [start, end) of the match inside `name`, when the name matched. */
  match: [number, number] | null
}

/** Ranks indexed files: name prefix, then name substring, then path substring. */
export function rankChatFileTreeSearch(
  files: ReadonlyArray<{ path: string; name: string; relativePath: string; workspaceRoot?: string }>,
  query: string,
  limit = 200
): ChatFileTreeSearchHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const scored: Array<{ score: number; hit: ChatFileTreeSearchHit }> = []
  for (const file of files) {
    const name = file.name.toLocaleLowerCase()
    const at = name.indexOf(needle)
    const pathAt = at >= 0 ? -1 : file.relativePath.toLocaleLowerCase().indexOf(needle)
    if (at < 0 && pathAt < 0) continue
    const score = at === 0 ? 0 : at > 0 ? 1 : 2
    const directory = file.relativePath.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
    scored.push({
      score,
      hit: {
        path: file.path,
        name: file.name,
        relativeDirectory: directory,
        root: file.workspaceRoot ?? '',
        match: at >= 0 ? [at, at + needle.length] : null
      }
    })
  }
  return scored
    .sort((left, right) => left.score - right.score || left.hit.name.length - right.hit.name.length ||
      left.hit.relativeDirectory.localeCompare(right.hit.relativeDirectory))
    .slice(0, limit)
    .map((item) => item.hit)
}

export function chatFileTreeRowKey(path: string): string {
  return chatFileTreePathKey(path)
}
