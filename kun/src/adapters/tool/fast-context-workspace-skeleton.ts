import { FAST_CONTEXT_LARGE_WORKSPACE_FILE_COUNT } from './builtin-tool-types.js'
import type { FastContextFileIndex } from './fast-context-file-index.js'

/**
 * Compact workspace overview handed to the retrieval child so its first round
 * can name a directory instead of grepping the whole tree. Built from the
 * cached file index; deterministic for a given listing; at most ~2 KB.
 */
const MAX_SKELETON_CHARACTERS = 2_000
const MAX_TOP_LEVEL = 12
const MAX_CHILDREN = 6
const MAX_ROOT_FILES = 10
const MAX_EXTENSIONS = 8

type DirectoryCount = { name: string; count: number; children: Map<string, number> }

const formatCount = (value: number) => value.toLocaleString('en-US')

function extensionOf(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null
}

export function buildFastContextWorkspaceSkeleton(index: FastContextFileIndex): string {
  if (index.files.length === 0) return ''
  const directories = new Map<string, DirectoryCount>()
  const rootFiles: string[] = []
  const extensions = new Map<string, number>()
  for (const file of index.files) {
    const extension = extensionOf(file)
    if (extension) extensions.set(extension, (extensions.get(extension) ?? 0) + 1)
    const parts = file.split('/')
    if (parts.length === 1) {
      rootFiles.push(file)
      continue
    }
    const top = parts[0]!
    const entry = directories.get(top) ?? { name: top, count: 0, children: new Map<string, number>() }
    entry.count += 1
    if (parts.length > 2) entry.children.set(parts[1]!, (entry.children.get(parts[1]!) ?? 0) + 1)
    directories.set(top, entry)
  }
  const byCount = <T extends { count: number; name: string }>(left: T, right: T) =>
    right.count - left.count || left.name.localeCompare(right.name)
  const lines = [
    `Workspace overview (${formatCount(index.files.length)}${index.truncated ? '+' : ''} searchable files; dependency, build, and cache directories excluded):`
  ]
  const languages = [...extensions.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_EXTENSIONS)
    .map(([extension, count]) => `${extension} ${formatCount(count)}`)
  if (languages.length) lines.push(`File types: ${languages.join(', ')}`)
  const tops = [...directories.values()].sort(byCount)
  if (tops.length) lines.push('Top-level directories (file counts):')
  for (const top of tops.slice(0, MAX_TOP_LEVEL)) {
    const children = [...top.children.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(byCount)
      .slice(0, MAX_CHILDREN)
      .map((child) => `${child.name}/ ${formatCount(child.count)}`)
    lines.push(`- ${top.name}/ ${formatCount(top.count)}${children.length ? `: ${children.join(', ')}` : ''}`)
  }
  if (tops.length > MAX_TOP_LEVEL) lines.push(`- (+${tops.length - MAX_TOP_LEVEL} more directories)`)
  if (rootFiles.length) {
    const shown = rootFiles.slice(0, MAX_ROOT_FILES).join(', ')
    lines.push(`Root files: ${shown}${rootFiles.length > MAX_ROOT_FILES ? ` (+${rootFiles.length - MAX_ROOT_FILES} more)` : ''}`)
  }
  if (index.files.length > FAST_CONTEXT_LARGE_WORKSPACE_FILE_COUNT || index.truncated) {
    lines.push('This workspace is large: every grep must pass a path or a glob; unscoped root greps are refused.')
  }
  let text = ''
  for (const line of lines) {
    if (text.length + line.length + 1 > MAX_SKELETON_CHARACTERS) break
    text += `${text ? '\n' : ''}${line}`
  }
  return text
}
