export type ComposerFileReferenceKind = 'file' | 'directory'

export type ComposerFileReference = {
  path: string
  relativePath: string
  name: string
  type?: ComposerFileReferenceKind
  /** null explicitly allows a user-picked file outside the active workspace. */
  workspaceRoot?: string | null
}

export type ComposerFileMention = {
  start: number
  end: number
  query: string
  quoted: boolean
}

export type ComposerFileContextEntry = {
  relativePath: string
  content: string
  truncated?: boolean
}

const FILE_MENTION_BOUNDARY = /(^|[\s([{，。；：、])@([^\s@"']*)$/u
const QUOTED_FILE_MENTION_BOUNDARY = /(^|[\s([{，。；：、])@"([^"\n\r]*)$/u
const TOKEN_SPECIAL_CHARS = /[\s"']/u

function normalizeSlashes(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/')
}

function trimTrailingSlash(value: string): string {
  return normalizeSlashes(value).replace(/\/+$/g, '')
}

function normalizeForCompare(value: string): string {
  return trimTrailingSlash(value).toLowerCase()
}

export function relativeWorkspacePath(path: string, workspaceRoot: string): string {
  const normalizedPath = normalizeSlashes(path)
  const normalizedRoot = trimTrailingSlash(workspaceRoot)
  const comparablePath = normalizeForCompare(normalizedPath)
  const comparableRoot = normalizeForCompare(normalizedRoot)
  if (comparableRoot && comparablePath === comparableRoot) return ''
  if (comparableRoot && comparablePath.startsWith(`${comparableRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

export function composerFileReferenceFromPath(
  path: string,
  workspaceRoot: string
): ComposerFileReference {
  const normalizedPath = normalizeSlashes(path)
  const relativePath = relativeWorkspacePath(normalizedPath, workspaceRoot)
  const insideWorkspace = normalizeForCompare(relativePath) !== normalizeForCompare(normalizedPath)
  return {
    path: normalizedPath,
    relativePath,
    name: normalizedPath.split('/').filter(Boolean).pop() || normalizedPath,
    type: 'file',
    ...(insideWorkspace ? {} : { workspaceRoot: null })
  }
}

export function composerFileReferenceKey(reference: Pick<ComposerFileReference, 'relativePath'>): string {
  return normalizeForCompare(reference.relativePath)
}

export function isComposerDirectoryReference(
  reference: Pick<ComposerFileReference, 'type'>
): boolean {
  return reference.type === 'directory'
}

export function isFileWithinDirectory(fileRelativePath: string, dirRelativePath: string): boolean {
  const dir = normalizeForCompare(dirRelativePath)
  if (!dir) return true
  const file = normalizeForCompare(fileRelativePath)
  return file === dir || file.startsWith(`${dir}/`)
}

export function formatComposerFileMentionToken(relativePath: string, isDirectory = false): string {
  const base = normalizeSlashes(relativePath)
  const path = isDirectory ? `${trimTrailingSlash(base)}/` : base
  if (!TOKEN_SPECIAL_CHARS.test(path)) return `@${path}`
  return `@"${path.replaceAll('"', '\\"')}"`
}

export function getFileMentionAtCursor(input: string, cursor: number): ComposerFileMention | null {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length))
  const beforeCursor = input.slice(0, boundedCursor)
  const quoted = QUOTED_FILE_MENTION_BOUNDARY.exec(beforeCursor)
  if (quoted) {
    const query = quoted[2] ?? ''
    const start = boundedCursor - query.length - 2
    return { start, end: boundedCursor, query, quoted: true }
  }

  const plain = FILE_MENTION_BOUNDARY.exec(beforeCursor)
  if (!plain) return null
  const query = plain[2] ?? ''
  const start = boundedCursor - query.length - 1
  return { start, end: boundedCursor, query, quoted: false }
}

export function replaceFileMentionInInput(
  input: string,
  mention: ComposerFileMention,
  reference: Pick<ComposerFileReference, 'relativePath' | 'type'>
): { input: string; cursor: number } {
  const token = formatComposerFileMentionToken(
    reference.relativePath,
    isComposerDirectoryReference(reference)
  )
  const replacement = `${token}${input[mention.end] && /\s/u.test(input[mention.end] ?? '') ? '' : ' '}`
  const nextInput = `${input.slice(0, mention.start)}${replacement}${input.slice(mention.end)}`
  return {
    input: nextInput,
    cursor: mention.start + replacement.length
  }
}

// A character that can continue an unquoted mention token (path segment,
// slash, dot, …). When it follows a matched token, the token is only a prefix
// of a longer mention and must not be removed.
const MENTION_TOKEN_CONTINUATION = /[^\s@"'([{)\]}，。；：、,;:]/u

function isMentionTokenBoundary(char: string | undefined): boolean {
  if (char === undefined) return true
  return !MENTION_TOKEN_CONTINUATION.test(char)
}

export function removeComposerFileMentionToken(
  input: string,
  relativePath: string,
  isDirectory = false
): string {
  const normalized = trimTrailingSlash(relativePath)
  // Longest / most specific variants first so a directory token (`@dir/`) is
  // matched before its prefix (`@dir`) and never clips a nested file mention.
  const candidates = isDirectory
    ? [`@"${normalized}/"`, `@"${normalized}"`, `@${normalized}/`, `@${normalized}`]
    : [`@"${normalized}"`, `@${normalized}`]
  for (const token of candidates) {
    let from = 0
    while (from <= input.length) {
      const index = input.indexOf(token, from)
      if (index < 0) break
      const quoted = token.endsWith('"')
      if (quoted || isMentionTokenBoundary(input[index + token.length])) {
        const before = input.slice(0, index).replace(/[ \t]+$/u, '')
        const after = input.slice(index + token.length).replace(/^[ \t]+/u, '')
        return `${before}${before && after ? ' ' : ''}${after}`
      }
      from = index + token.length
    }
  }
  return input
}

export function mergeComposerFileReferences(
  current: ComposerFileReference[],
  nextReference: ComposerFileReference
): ComposerFileReference[] {
  const key = composerFileReferenceKey(nextReference)
  const existing = current.findIndex((reference) => composerFileReferenceKey(reference) === key)
  if (existing < 0) return [...current, nextReference]
  return current.map((reference, index) => index === existing ? nextReference : reference)
}

function scoreFileSuggestion(reference: ComposerFileReference, query: string): number {
  const normalizedQuery = normalizeForCompare(query)
  if (!normalizedQuery) return 1
  const name = reference.name.toLowerCase()
  const relativePath = normalizeSlashes(reference.relativePath).toLowerCase()
  if (name === normalizedQuery) return 100
  if (relativePath === normalizedQuery) return 95
  if (name.startsWith(normalizedQuery)) return 80
  if (relativePath.startsWith(normalizedQuery)) return 70
  if (relativePath.includes(`/${normalizedQuery}`)) return 55
  if (name.includes(normalizedQuery)) return 40
  if (relativePath.includes(normalizedQuery)) return 25
  const queryParts = normalizedQuery.split(/[/\s._-]+/u).filter(Boolean)
  if (queryParts.length > 1 && queryParts.every((part) => relativePath.includes(part))) return 15
  return 0
}

function directoryRank(reference: ComposerFileReference): number {
  return reference.type === 'directory' ? 0 : 1
}

export function filterWorkspaceFileMentionSuggestions(
  files: ComposerFileReference[],
  query: string,
  selected: ComposerFileReference[] = [],
  limit = 20
): ComposerFileReference[] {
  const selectedKeys = new Set(selected.map(composerFileReferenceKey))
  // A trailing slash (`@src/`) signals the user is reaching for a directory.
  const wantsDirectory = /\/\s*$/u.test(query)
  return files
    .map((file) => {
      let score = scoreFileSuggestion(file, query)
      if (score > 0 && wantsDirectory && file.type === 'directory') score += 5
      return { file, score }
    })
    .filter((entry) => entry.score > 0 && !selectedKeys.has(composerFileReferenceKey(entry.file)))
    .sort((left, right) =>
      right.score - left.score ||
      (wantsDirectory ? directoryRank(left.file) - directoryRank(right.file) : 0) ||
      left.file.relativePath.length - right.file.relativePath.length ||
      left.file.relativePath.localeCompare(right.file.relativePath)
    )
    .slice(0, limit)
    .map((entry) => entry.file)
}

function escapeFileContextAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildComposerFileContextPrompt(
  userPrompt: string,
  files: ComposerFileContextEntry[]
): string {
  if (files.length === 0) return userPrompt
  const fileBlocks = files.map((file) => {
    const truncated = file.truncated ? ' truncated="true"' : ''
    return [
      `<workspace_file path="${escapeFileContextAttribute(file.relativePath)}"${truncated}>`,
      file.content,
      '</workspace_file>'
    ].join('\n')
  })

  return [
    'The user referenced these workspace files. Use them as context for the request.',
    '',
    ...fileBlocks,
    '',
    'User request:',
    userPrompt.trim() || 'Please review the referenced workspace file(s).'
  ].join('\n')
}
