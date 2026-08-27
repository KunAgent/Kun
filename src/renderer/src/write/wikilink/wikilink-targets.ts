/**
 * Reference targets for the `[[` menu, and how a chosen one becomes link text.
 *
 * Targets span every Work workspace, not just the open one, so the menu can
 * reference a note that lives in another root. Ranking keeps the current
 * workspace first because that is the common case and the only case whose links
 * the folder graph can draw an edge for.
 */
export type WikilinkTarget = {
  /** Absolute workspace root this file belongs to. */
  workspaceRoot: string
  /** Display name for the workspace, used as the row's secondary label. */
  workspaceName: string
  /** Workspace-relative path, POSIX separators. */
  relativePath: string
  /** File name without directories. */
  name: string
}

export type RankedWikilinkTarget = WikilinkTarget & {
  score: number
  /** True when the target is outside the workspace being edited. */
  external: boolean
}

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Makes a path workspace-relative.
 *
 * The Write store carries absolute paths (`WorkspaceEntry.path` is
 * `join(root, name)`), while scanned targets are workspace-relative. Comparing
 * or diffing the two directly offered the file being edited as a link to
 * itself, and produced insertions that walked up out of every absolute segment
 * (`../../../../welcome`). Everything normalizes through here first.
 */
export function workspaceRelativePath(workspaceRoot: string, path: string): string {
  const normalizedPath = toPosix(path)
  const root = toPosix(workspaceRoot).replace(/\/+$/, '')
  if (!root) return normalizedPath.replace(/^\/+/, '')
  if (normalizedPath === root) return ''
  if (normalizedPath.startsWith(`${root}/`)) return normalizedPath.slice(root.length + 1)
  return normalizedPath
}

function directoryOf(path: string): string {
  const normalized = toPosix(path)
  const separator = normalized.lastIndexOf('/')
  return separator === -1 ? '' : normalized.slice(0, separator)
}

/**
 * Drops a trailing `.md` the way Obsidian writes links, but only when the
 * remaining name has no dot left. `resolveKnowledgeLink` appends `.md` to an
 * extensionless target, so `notes/a.b.md` shortened to `notes/a.b` would stop
 * resolving — that one keeps its extension.
 */
export function shortenMarkdownPath(relativePath: string): string {
  const normalized = toPosix(relativePath)
  if (!normalized.toLowerCase().endsWith('.md')) return normalized
  const withoutExtension = normalized.slice(0, -3)
  const base = withoutExtension.slice(withoutExtension.lastIndexOf('/') + 1)
  return base.includes('.') ? normalized : withoutExtension
}

/** POSIX-style relative path from one directory to one file. */
export function relativePathFrom(fromDirectory: string, toPath: string): string {
  const from = toPosix(fromDirectory).replace(/\/+$/, '').split('/').filter(Boolean)
  const to = toPosix(toPath).split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1
  const up = from.slice(shared).map(() => '..')
  const down = to.slice(shared)
  const joined = [...up, ...down].join('/')
  return joined || '.'
}

/**
 * Volume root of an absolute path: the drive letter for Windows drive paths
 * (`c:`), the server/share pair for UNC paths (`//server/share`), and `''`
 * for POSIX paths, which all share one volume. Case-insensitive because
 * Windows volumes are.
 */
export function pathVolumeRoot(path: string): string {
  const normalized = toPosix(path)
  const drive = /^([A-Za-z]):/.exec(normalized)
  if (drive) return `${drive[1]!.toLocaleLowerCase()}:`
  const unc = /^\/\/([^/]+)\/([^/]+)/.exec(normalized)
  if (unc) return `//${unc[1]}/${unc[2]}`.toLocaleLowerCase()
  return ''
}

/**
 * True when two absolute paths live on different volumes, where no `..` walk
 * can reach from one to the other (`../../D:/notes` is not a real path).
 */
export function crossesVolumes(left: string, right: string): boolean {
  return pathVolumeRoot(left) !== pathVolumeRoot(right)
}

export type WikilinkInsertionContext = {
  /** Workspace root of the file being edited. */
  workspaceRoot: string
  /** Path of the file being edited; absolute or workspace-relative. */
  activePath: string
}

/**
 * Link text for a chosen target.
 *
 * Same workspace: a path relative to the editing file, which is exactly what
 * the graph's link resolver understands. Different workspace: a path relative
 * between the two absolute roots, so it still points at a real file on disk —
 * but note the folder graph is rooted at one workspace and will not draw an
 * edge that escapes it.
 */
export function buildWikilinkInsertion(
  target: WikilinkTarget,
  context: WikilinkInsertionContext
): string {
  const activeDirectory = directoryOf(
    workspaceRelativePath(context.workspaceRoot, context.activePath)
  )
  if (target.workspaceRoot === context.workspaceRoot) {
    return shortenMarkdownPath(relativePathFrom(activeDirectory, target.relativePath))
  }
  const toAbsolute = [toPosix(target.workspaceRoot).replace(/\/+$/, ''), target.relativePath]
    .filter(Boolean)
    .join('/')
  // Different volumes (Windows drives, UNC shares): no `..` walk exists, so
  // the absolute path is the only representation that still names the file.
  // Ranking already withholds such targets from the menu; this is the guard
  // for any other caller.
  if (crossesVolumes(context.workspaceRoot, target.workspaceRoot)) {
    return shortenMarkdownPath(toAbsolute)
  }
  const fromAbsolute = [toPosix(context.workspaceRoot).replace(/\/+$/, ''), activeDirectory]
    .filter(Boolean)
    .join('/')
  return shortenMarkdownPath(relativePathFrom(fromAbsolute, toAbsolute))
}

function scoreTarget(target: WikilinkTarget, query: string): number {
  if (!query) return 1
  const name = target.name.toLocaleLowerCase()
  const path = target.relativePath.toLocaleLowerCase()
  const stem = name.replace(/\.md$/i, '')
  if (stem === query) return 100
  if (name.startsWith(query) || stem.startsWith(query)) return 80
  if (name.includes(query)) return 60
  if (path.startsWith(query)) return 50
  if (path.includes(query)) return 40
  // Subsequence match, so "alph" still finds "a-long-alpha-note".
  return matchesSubsequence(path, query) ? 15 : 0
}

function matchesSubsequence(haystack: string, needle: string): boolean {
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return needle.length === 0
}

export type RankWikilinkOptions = {
  workspaceRoot: string
  /** Path of the file being edited; absolute or workspace-relative. */
  activePath: string
  limit?: number
}

/**
 * Ranks targets for a query. The file being edited is never offered — a note
 * linking to itself is never what the caret is asking for — and neither is a
 * note on another volume (Windows drive / UNC share), because no relative
 * path can reach it and the link could never resolve.
 */
export function rankWikilinkTargets(
  targets: readonly WikilinkTarget[],
  query: string,
  options: RankWikilinkOptions
): RankedWikilinkTarget[] {
  const normalized = query.trim().toLocaleLowerCase()
  const activePath = workspaceRelativePath(options.workspaceRoot, options.activePath)
  const activeVolume = pathVolumeRoot(options.workspaceRoot)
  const ranked: RankedWikilinkTarget[] = []
  for (const target of targets) {
    const external = target.workspaceRoot !== options.workspaceRoot
    if (!external && toPosix(target.relativePath) === activePath) continue
    if (external && pathVolumeRoot(target.workspaceRoot) !== activeVolume) continue
    const score = scoreTarget(target, normalized)
    if (score <= 0) continue
    // Same-workspace results outrank equally-good external ones.
    ranked.push({ ...target, external, score: external ? score : score + 5 })
  }
  ranked.sort((left, right) =>
    right.score - left.score ||
    left.relativePath.length - right.relativePath.length ||
    left.relativePath.localeCompare(right.relativePath) ||
    left.workspaceRoot.localeCompare(right.workspaceRoot)
  )
  return ranked.slice(0, options.limit ?? 12)
}
