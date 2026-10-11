/**
 * Pure tree model behind the paper folder chooser. The library lists folders as
 * flat relative paths (`a`, `a/b`); the chooser shows them as a real directory
 * tree: missing ancestors are filled in, rows carry their depth and paper
 * counts, and collapsed branches hide their children.
 */

export type FolderTreeRow = {
  /** Path relative to the papers dir. */
  folder: string
  /** Last path segment. */
  name: string
  /** 0 for folders directly under the papers dir. */
  depth: number
  /** Papers in this folder and everything below it. */
  total: number
  hasChildren: boolean
  expanded: boolean
}

export function parentFolder(folder: string): string {
  const cut = folder.lastIndexOf('/')
  return cut < 0 ? '' : folder.slice(0, cut)
}

/** `a/b/c` -> `['a', 'a/b']` (outermost first). */
export function ancestorFolders(folder: string): string[] {
  const parts = folder.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

function compareFolders(a: string, b: string): number {
  const left = a.split('/')
  const right = b.split('/')
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = left[index].localeCompare(right[index])
    if (order !== 0) return order
  }
  return left.length - right.length
}

/** Every folder plus its ancestors, parents before children. */
export function expandFolderPaths(groups: readonly string[]): string[] {
  const all = new Set<string>()
  for (const group of groups) {
    if (!group) continue
    all.add(group)
    for (const ancestor of ancestorFolders(group)) all.add(ancestor)
  }
  return [...all].sort(compareFolders)
}

/** Papers per folder, each also counted in every ancestor. */
export function folderTotals(entryGroups: readonly string[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const group of entryGroups) {
    if (!group) continue
    totals.set(group, (totals.get(group) ?? 0) + 1)
    for (const ancestor of ancestorFolders(group)) totals.set(ancestor, (totals.get(ancestor) ?? 0) + 1)
  }
  return totals
}

export function buildFolderRows(input: {
  groups: readonly string[]
  /** `entry.group` of every paper in the library ('' = top level). */
  entryGroups: readonly string[]
  expanded: ReadonlySet<string>
  /** Case-insensitive path filter; a non-empty query flattens the tree. */
  query?: string
}): FolderTreeRow[] {
  const folders = expandFolderPaths(input.groups)
  const totals = folderTotals(input.entryGroups)
  const withChildren = new Set(folders.map(parentFolder).filter(Boolean))
  const needle = (input.query ?? '').trim().toLowerCase()
  const row = (folder: string, depth: number): FolderTreeRow => ({
    folder,
    name: folder.slice(folder.lastIndexOf('/') + 1),
    depth,
    total: totals.get(folder) ?? 0,
    hasChildren: withChildren.has(folder),
    expanded: input.expanded.has(folder)
  })
  if (needle) {
    return folders.filter((folder) => folder.toLowerCase().includes(needle)).map((folder) => row(folder, 0))
  }
  const rows: FolderTreeRow[] = []
  for (const folder of folders) {
    if (ancestorFolders(folder).some((ancestor) => !input.expanded.has(ancestor))) continue
    rows.push(row(folder, folder.split('/').length - 1))
  }
  return rows
}
