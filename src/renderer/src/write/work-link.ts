/**
 * Link target resolution for the Work markdown editor (implementation
 * §7.7). Pure classification — actual filesystem checks go through
 * `window.kunGui.resolveWorkspaceFile` so workspace-boundary rules stay in
 * the main process.
 */
import {
  isExplicitWriteResourceUrl,
  resolveWriteMarkdownResourcePath
} from '@shared/write-markdown-resource'

export type WorkLinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; slug: string }
  | { kind: 'workspace-file'; path: string; slug?: string; line?: number }
  | { kind: 'invalid'; reason: string }

/** GitHub-compatible heading slug: lowercase, punctuation removed,
 * spaces become `-`. Duplicate disambiguation (`-1`) happens at render
 * time, not here. */
export function workHeadingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/')
}

function isInsideRoot(path: string, workspaceRoot: string): boolean {
  const root = normalizeSlashes(workspaceRoot).replace(/\/+$/, '')
  const normalized = normalizeSlashes(path)
  return normalized === root || normalized.startsWith(`${root}/`)
}

/**
 * `href` forms handled:
 * - `scheme:…` (`https:`, `mailto:`, …) → external (`file:` is rejected)
 * - `#heading` → in-document anchor
 * - `path`, `path#heading`, `path#L12` → workspace file (resolved against
 *   the current file's directory; must stay inside `workspaceRoot`)
 */
export function resolveWorkLinkTarget(
  href: string,
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined
): WorkLinkTarget {
  const value = href.trim()
  if (!value) return { kind: 'invalid', reason: 'empty' }

  if (value.startsWith('#')) {
    const slug = workHeadingSlug(value.slice(1))
    return slug ? { kind: 'anchor', slug } : { kind: 'invalid', reason: 'empty-anchor' }
  }

  if (isExplicitWriteResourceUrl(value)) {
    if (value.toLowerCase().startsWith('file:')) {
      return { kind: 'invalid', reason: 'file-url' }
    }
    return { kind: 'external', url: value }
  }

  if (!filePath || !workspaceRoot) {
    return { kind: 'invalid', reason: 'no-workspace' }
  }

  const [pathnamePart, hashPart] = value.split('#', 2)
  const pathname = pathnamePart.trim()
  let slug: string | undefined
  let line: number | undefined
  if (hashPart) {
    const lineMatch = hashPart.match(/^L(\d+)$/)
    if (lineMatch) {
      line = Number.parseInt(lineMatch[1], 10)
    } else {
      slug = workHeadingSlug(hashPart)
    }
  }

  if (!pathname) {
    return slug ? { kind: 'anchor', slug } : { kind: 'invalid', reason: 'empty' }
  }

  const resolved = resolveWriteMarkdownResourcePath(
    decodeURIComponentSafe(pathname) + (hashPart ? '' : ''),
    filePath
  )
  if (!resolved) return { kind: 'invalid', reason: 'unresolvable' }
  if (!isInsideRoot(resolved, workspaceRoot)) {
    return { kind: 'invalid', reason: 'outside-workspace' }
  }
  return { kind: 'workspace-file', path: resolved, slug, line }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Resolve a wiki-link `[[target]]` to a workspace file. The target may be
 * a path relative to the current file's directory or a bare note name; in
 * the bare-name case callers should fall back to a workspace search. */
export function resolveWikiLinkFilePath(
  target: string,
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined
): { path: string; bareName: boolean } | null {
  const value = target.trim()
  if (!value || !filePath || !workspaceRoot) return null
  const bareName = !value.includes('/')
  const candidate = bareName ? `${value}.md` : value
  const resolved = resolveWriteMarkdownResourcePath(candidate, filePath)
  if (resolved && isInsideRoot(resolved, workspaceRoot)) {
    return { path: resolved, bareName }
  }
  if (!bareName) return null
  // Bare names also resolve from the workspace root.
  const joined = normalizeSlashes(`${workspaceRoot.replace(/\/+$/, '')}/${candidate}`)
  return isInsideRoot(joined, workspaceRoot) ? { path: joined, bareName } : null
}
