import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { effectiveSandboxMode, pathAllowedByScopes } from './sandbox-policy.js'
import { isBackgroundShellOutputPath } from '../../services/background-shell-output.js'
import type {
  EditInstruction,
  FsStats,
  ImageDetection,
  ListEntry,
  ReadClassification,
  ResizedImageResult,
  TruncateMode
} from './builtin-tool-types.js'
import { COMPACT_RESOURCE_FILE_NAMES, FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES } from './builtin-tool-types.js'
import {
  isPathInsideOrEqual,
  resolveExistingWorkspaceRoot,
  resolvePathThroughSymlinks,
  sameFilesystemPath,
  workspaceRoot
} from './workspace-path.js'
export { workspaceRoot } from './workspace-path.js'
export * from './builtin-shell-utils.js'


export async function withToolBoundary(
  run: () => Promise<{ output: unknown; isError?: boolean }>
): Promise<{ output: unknown; isError?: boolean }> {
  try {
    return await run()
  } catch (error) {
    return {
      output: {
        error: error instanceof Error ? error.message : String(error)
      },
      isError: true
    }
  }
}

export async function resolveWorkspacePath(
  inputPath: string,
  context: ToolHostContext,
  options: { enforceWorkspaceBoundary?: boolean } = {}
): Promise<{
  workspaceRoot: string
  absolutePath: string
  relativePath: string
}> {
  const roots = [...new Set([context.workspace, ...(context.additionalWorkspaces ?? [])].map(workspaceRoot))]
  const root = roots[0]!
  const lexicalAbsolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  const delegatedPathBoundary = context.allowedReadPaths !== undefined
  if (
    delegatedPathBoundary &&
    !pathAllowedByScopes(lexicalAbsolutePath, root, context.allowedReadPaths ?? [])
  ) {
    throw new Error(`path is outside the delegated child read scopes: ${inputPath}`)
  }
  if (
    !delegatedPathBoundary &&
    !options.enforceWorkspaceBoundary &&
    isBackgroundShellOutputPath(lexicalAbsolutePath, {
      runtimeDataDir: context.runtimeDataDir,
      threadId: context.threadId
    })
  ) {
    return {
      workspaceRoot: root,
      absolutePath: resolve(lexicalAbsolutePath),
      relativePath: normalizeToolPath(relative(root, resolve(lexicalAbsolutePath)) || '.')
    }
  }
  // Full-access and host-read discussion may reach paths outside the workspace.
  // Writes still follow canWritePath()/sandboxMode; this only authorizes reads.
  if (
    !delegatedPathBoundary &&
    !options.enforceWorkspaceBoundary &&
    (effectiveSandboxMode(context) === 'danger-full-access' || context.allowHostReads === true)
  ) {
    return {
      workspaceRoot: root,
      absolutePath: lexicalAbsolutePath,
      relativePath: normalizeToolPath(relative(root, lexicalAbsolutePath) || '.')
    }
  }
  const primaryRoot = await resolveExistingWorkspaceRoot(root)
  const additionalRoots = await Promise.all(roots.slice(1).map((lexicalRoot) =>
    resolveExistingWorkspaceRoot(lexicalRoot).catch(() => null)
  ))
  const resolvedRoots = [primaryRoot, ...additionalRoots.filter((entry) => entry !== null)]
  const resolvedAbsolute = await resolvePathThroughSymlinks(lexicalAbsolutePath)
  // A lexical allow-list alone is insufficient: `src/link` can look in scope
  // while its physical target points at another workspace directory. Resolve
  // both the requested target and the delegated scopes before authorizing a
  // read, just as delegated writes validate their physical scopes.
  if (delegatedPathBoundary) {
    const physicalReadScopes = delegatedPhysicalReadScopes(
      primaryRoot,
      context.allowedReadPaths ?? []
    )
    if (!physicalReadScopes.some((scope) => isPathInsideOrEqual(scope, resolvedAbsolute))) {
      throw new Error(`path resolves outside the delegated child read scopes: ${inputPath}`)
    }
  }
  const matchingRoot = resolvedRoots.find((candidate) => isPathInsideOrEqual(candidate.physicalRoot, resolvedAbsolute))
  const isInsideWorkspace = Boolean(matchingRoot)
  const isApprovedExternalPath = !options.enforceWorkspaceBoundary &&
    context.approvedExternalWriteTargets?.some((target) =>
      sameFilesystemPath(target.path, resolvedAbsolute)
    ) === true
  if (!isInsideWorkspace && !isApprovedExternalPath) {
    throw new Error(`path escapes the workspace root: ${inputPath}`)
  }
  // Workspace callers keep the lexical path expected by subprocess/display
  // layers. External grants use the physical path that was checked so a
  // symlink alias cannot be redirected after validation.
  return {
    workspaceRoot: matchingRoot?.lexicalRoot ?? root,
    absolutePath: isApprovedExternalPath ? resolvedAbsolute : lexicalAbsolutePath,
    relativePath: normalizeToolPath(relative(matchingRoot?.lexicalRoot ?? root, lexicalAbsolutePath) || '.')
  }
}

function delegatedPhysicalReadScopes(
  workspace: { lexicalRoot: string; physicalRoot: string },
  scopes: readonly string[]
): string[] {
  return scopes.flatMap((scope) => {
    const lexicalScope = isAbsolute(scope)
      ? resolve(scope)
      : resolve(workspace.lexicalRoot, scope)
    if (!isPathInsideOrEqual(workspace.lexicalRoot, lexicalScope)) return undefined
    // Do not follow a symlink in the allowed scope itself. The scope grants a
    // lexical subtree (for example `src`), so its physical counterpart is
    // the same relative subtree under the physical workspace root. Otherwise
    // a `src -> private` link could expand the granted scope.
    const physicalScope = resolve(
      workspace.physicalRoot,
      relative(workspace.lexicalRoot, lexicalScope)
    )
    return isPathInsideOrEqual(workspace.physicalRoot, physicalScope)
      ? physicalScope
      : undefined
  }).filter((scope): scope is string => Boolean(scope))
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

export function detectImageMimeType(buffer: Buffer): ImageDetection | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      return {
        mimeType: 'image/png',
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      }
    }
    return { mimeType: 'image/png' }
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3 && size >= 7) {
        return {
          mimeType: 'image/jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }
      offset += 2 + size
    }
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') {
      if (buffer.length >= 10) {
        return {
          mimeType: 'image/gif',
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8)
        }
      }
      return { mimeType: 'image/gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (buffer.length >= 30 && buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
      return {
        mimeType: 'image/webp',
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      }
    }
    return { mimeType: 'image/webp' }
  }
  return null
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join('/')
}

export function getReadClassification(absolutePath: string, workspace: string): ReadClassification | undefined {
  const fileName = basename(absolutePath)
  if (fileName === 'SKILL.md') {
    return { kind: 'skill', label: basename(dirname(absolutePath)) || fileName }
  }
  if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
    return {
      kind: 'resource',
      label: toPosixPath(relative(workspaceRoot(workspace), absolutePath) || fileName)
    }
  }
  const relativePath = toPosixPath(relative(workspaceRoot(workspace), absolutePath))
  if (relativePath === 'README.md' || relativePath.startsWith('docs/') || relativePath.startsWith('examples/')) {
    return { kind: 'docs', label: relativePath }
  }
  return undefined
}

export function formatDimensionNote(image: ResizedImageResult): string | undefined {
  if (!image.wasResized || !image.originalWidth || !image.originalHeight) return undefined
  const scale = image.originalWidth / image.width
  return `[Image: original ${image.originalWidth}x${image.originalHeight}, displayed at ${image.width}x${image.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`
}

export function describeKind(mode: TruncateMode): string {
  return mode === 'head' ? 'first' : 'last'
}

export async function collectPaths(root: string, options: {
  includeDirectories?: boolean
  limit: number
  /** Optional traversal guard for bounded callers such as Fast Context. */
  shouldSkipDirectory?: (path: string) => boolean
  signal?: AbortSignal
}): Promise<string[]> {
  const results: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && results.length < options.limit) {
    if (options.signal?.aborted) throw new Error('command aborted')
    const current = queue.shift()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (options.signal?.aborted) throw new Error('command aborted')
      const next = join(current, entry.name)
      if (entry.isDirectory()) {
        if (options.shouldSkipDirectory?.(next)) continue
        if (options.includeDirectories) results.push(next)
        queue.push(next)
      } else {
        results.push(next)
      }
      if (results.length >= options.limit) break
    }
  }
  return results
}

export async function listDirectory(targetPath: string, root: string, recursive: boolean, limit: number): Promise<ListEntry[]> {
  const targetStat = await stat(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdir(targetPath, { withFileTypes: true })
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await stat(entryPath)))
    }
    return result
  }

  const paths = await collectPaths(targetPath, { includeDirectories: true, limit })
  const result: ListEntry[] = []
  for (const filePath of paths) {
    result.push(makeListEntry(filePath, root, await stat(filePath)))
  }
  return result
}

export async function listDirectoryWithOps(
  targetPath: string,
  root: string,
  recursive: boolean,
  limit: number,
  statOp: (path: string) => Promise<FsStats>,
  readdirOp: (path: string) => Promise<Array<{ name: string }>>
): Promise<ListEntry[]> {
  const targetStat = await statOp(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdirOp(targetPath)
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await statOp(entryPath)))
    }
    return result
  }
  return listDirectory(targetPath, root, recursive, limit)
}

export function makeListEntry(path: string, root: string, fileStat: FsStats): ListEntry {
  return {
    path,
    relative_path: normalizeToolPath(relative(root, path) || '.'),
    name: basename(path),
    kind: fileStat.isDirectory()
      ? 'directory'
      : fileStat.isFile()
        ? 'file'
        : fileStat.isSymbolicLink()
          ? 'symlink'
          : 'other',
    size: Number(fileStat.size)
  }
}

export function compilePattern(pattern: string, literal: boolean): RegExp {
  if (literal) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'i')
  }
  return new RegExp(pattern, 'i')
}


export function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function globToRegExp(pattern: string): RegExp {
  const optionalPrefix = pattern.startsWith('**/')
  const normalizedPattern = optionalPrefix ? pattern.slice(3) : pattern
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*')
  return new RegExp(`^${optionalPrefix ? '(?:.*/)?' : ''}${withWildcards}$`, 'iu')
}

export function normalizeToolPath(value: string): string {
  return value.replace(/\\/g, '/').split(sep).join('/')
}

/** Shared Fast Context guard for read, glob, and grep workspace paths. */
export function isFastContextExcludedRelativePath(value: string): boolean {
  const excluded = new Set<string>(FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES)
  return normalizeToolPath(value)
    .split('/')
    .some((component) => excluded.has(component.toLowerCase()))
}

export function isFastContextExcludedWorkspacePath(workspace: string, targetPath: string): boolean {
  return isFastContextExcludedRelativePath(relative(workspace, targetPath) || '.')
}

export function parseEditInstructions(args: Record<string, unknown>): EditInstruction[] {
  if (Array.isArray(args.edits)) {
    const edits = args.edits
      .map((value) => {
        if (!value || typeof value !== 'object') return null
        const raw = value as Record<string, unknown>
        return typeof raw.oldText === 'string' && typeof raw.newText === 'string'
          ? { oldText: raw.oldText, newText: raw.newText }
          : null
      })
      .filter((value): value is EditInstruction => value !== null)
    if (edits.length > 0) return edits
  }
  return typeof args.oldText === 'string' && typeof args.newText === 'string'
    ? [{ oldText: args.oldText, newText: args.newText }]
    : []
}

export function findOccurrences(source: string, needle: string): number[] {
  const matches: number[] = []
  if (!needle) return matches
  let index = 0
  while (true) {
    const next = source.indexOf(needle, index)
    if (next === -1) return matches
    matches.push(next)
    index = next + Math.max(1, needle.length)
  }
}

export function applyExactTextEdits(
  source: string,
  edits: EditInstruction[]
): { next: string; replacements: number } {
  const planned = edits.map((edit, index) => {
    const matches = findOccurrences(source, edit.oldText)
    if (matches.length === 0) {
      throw new Error(`edits[${index}].oldText was not found in the target file`)
    }
    if (matches.length > 1) {
      throw new Error(`edits[${index}].oldText matched ${matches.length} locations; each edit must be unique in the original file`)
    }
    return {
      start: matches[0]!,
      end: matches[0]! + edit.oldText.length,
      newText: edit.newText
    }
  })

  const sorted = [...planned].sort((a, b) => a.start - b.start)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.start < previous.end) {
      throw new Error('edit ranges overlap in the original file; merge nearby changes into one edit')
    }
  }

  let next = source
  for (const patch of [...sorted].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, patch.start)}${patch.newText}${next.slice(patch.end)}`
  }
  return { next, replacements: sorted.length }
}
