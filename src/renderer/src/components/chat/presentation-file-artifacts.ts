import type { ChatBlock, GeneratedFileReference, ToolBlock } from '../../agent/types'
import { PRESENTATION_STUDIO_EXTENSION_ID } from '@shared/presentation-artifact'

export type PresentationArtifactKind = 'powerpoint' | 'kun-html'

export type PresentationFileArtifact = {
  path: string
  name: string
  kind: PresentationArtifactKind
  extension: string
  mimeType?: string
  byteSize?: number
  contentSha256?: string
}

export const MAX_PRESENTATION_ARTIFACTS_PER_TURN = 16
export const PRESENTATION_STUDIO_ARTIFACT_PRODUCER = PRESENTATION_STUDIO_EXTENSION_ID
const MAX_PRESENTATION_ARTIFACT_PATH_LENGTH = 4096
const MAX_PRESENTATION_ARTIFACT_NAME_LENGTH = 256
const MAX_PRESENTATION_ARTIFACT_MIME_LENGTH = 128

const POWERPOINT_EXTENSIONS = new Set(['ppt', 'pptx'])

function normalizeSlashes(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/$/, '')
}

function collapseCurrentDirectorySegments(value: string): string {
  return normalizeSlashes(value).split('/').filter((segment) => segment !== '.').join('/')
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value)
}

function containsParentTraversal(path: string): boolean {
  return normalizeSlashes(path).split('/').includes('..')
}

function hasUnsafePathPrefix(path: string): boolean {
  if (path === '~' || path.startsWith('~/')) return true
  return /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[A-Za-z]:\//.test(path)
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) <= 0x1f) return true
  }
  return false
}

function caseComparablePath(path: string, platform: string): string {
  return platform === 'win32' ? path.toLowerCase() : path
}

function workspaceRelativeArtifactPath(
  path: string,
  workspaceRoot: string,
  platform: string
): string | null {
  let normalized = collapseCurrentDirectorySegments(path)
  const root = collapseCurrentDirectorySegments(workspaceRoot)
  if (!normalized || hasControlCharacter(normalized) || hasUnsafePathPrefix(normalized)) return null
  if (containsParentTraversal(normalized)) return null
  if (!root || !isAbsolutePath(root) || containsParentTraversal(root)) return null
  if (!isAbsolutePath(normalized)) return normalized

  const comparablePath = caseComparablePath(normalized, platform)
  const comparableRoot = caseComparablePath(root, platform)
  const comparablePrefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  if (!comparablePath.startsWith(comparablePrefix)) return null
  const prefixLength = root.endsWith('/') ? root.length : root.length + 1
  normalized = normalized.slice(prefixLength)
  return normalized || null
}

function pathKey(path: string, workspaceRoot: string, platform: string): string | null {
  const relative = workspaceRelativeArtifactPath(path, workspaceRoot, platform)
  if (!relative) return null
  return caseComparablePath(relative, platform)
}

function isTrustedKunHtmlProducer(block: ToolBlock): boolean {
  return block.meta?.presentationArtifactProducer === PRESENTATION_STUDIO_ARTIFACT_PRODUCER
}

function trustedContentSha256(block: ToolBlock): string | undefined {
  const value = block.meta?.presentationArtifactSha256
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined
}

function canPublishArtifact(block: ToolBlock, kind: PresentationArtifactKind): boolean {
  if (kind !== 'kun-html') return true
  return isTrustedKunHtmlProducer(block) && Boolean(trustedContentSha256(block))
}

function preferArtifactPath(existing: string, candidate: string): string {
  if (!isAbsolutePath(candidate) || isAbsolutePath(existing)) {
    return candidate
  }
  return existing
}

function nameFromPath(path: string): string {
  return normalizeSlashes(path).split('/').filter(Boolean).at(-1) ?? path
}

export function presentationArtifactKindForPath(
  path: string
): { kind: PresentationArtifactKind; extension: string } | null {
  if (!path.trim() || path.length > MAX_PRESENTATION_ARTIFACT_PATH_LENGTH) return null
  const normalized = normalizeSlashes(path).toLowerCase()
  if (normalized.endsWith('.kun-ppt.html')) {
    return { kind: 'kun-html', extension: 'HTML' }
  }
  const name = nameFromPath(normalized)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const extension = name.slice(dot + 1)
  if (POWERPOINT_EXTENSIONS.has(extension)) {
    return { kind: 'powerpoint', extension: extension.toUpperCase() }
  }
  return null
}

export function isPresentationArtifactPath(path: string | undefined): boolean {
  return typeof path === 'string' && presentationArtifactKindForPath(path) !== null
}

function generatedFilePath(file: GeneratedFileReference): string | undefined {
  return file.relativePath || file.path || file.absolutePath
}

function normalizeGeneratedFile(value: unknown): GeneratedFileReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const readString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const entry = raw[key]
      if (typeof entry === 'string' && entry.trim()) return entry.trim()
    }
    return undefined
  }
  const relativePath = readString('relativePath', 'relative_path')
  const path = readString('path', 'file')
  const absolutePath = readString('absolutePath', 'absolute_path')
  const name = readString('name', 'fileName', 'filename')?.slice(0, MAX_PRESENTATION_ARTIFACT_NAME_LENGTH)
  const mimeType = readString('mimeType', 'type', 'mediaType')?.slice(0, MAX_PRESENTATION_ARTIFACT_MIME_LENGTH)
  const byteSize = raw.byteSize
  return {
    ...(relativePath ? { relativePath } : {}),
    ...(path ? { path } : {}),
    ...(absolutePath ? { absolutePath } : {}),
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(typeof byteSize === 'number' && Number.isFinite(byteSize) && byteSize >= 0
      ? { byteSize }
      : {})
  }
}

function generatedFilesFrom(block: ToolBlock): GeneratedFileReference[] {
  const value = block.meta?.generatedFiles
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeGeneratedFile)
    .filter((file): file is GeneratedFileReference => file !== null)
}

export function derivePresentationFileArtifacts(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  platform = ''
): PresentationFileArtifact[] {
  const artifacts: PresentationFileArtifact[] = []
  const indexByPath = new Map<string, number>()

  const add = (block: ToolBlock, path: string, metadata?: GeneratedFileReference): void => {
    if (path.length > MAX_PRESENTATION_ARTIFACT_PATH_LENGTH) return
    const resolvedKind = presentationArtifactKindForPath(path)
    if (!resolvedKind || !canPublishArtifact(block, resolvedKind.kind)) return
    const key = pathKey(path, workspaceRoot, platform)
    if (!key) return
    const candidate: PresentationFileArtifact = {
      path,
      name: (metadata?.name?.trim() || nameFromPath(path)).slice(0, MAX_PRESENTATION_ARTIFACT_NAME_LENGTH),
      kind: resolvedKind.kind,
      extension: resolvedKind.extension,
      ...(metadata?.mimeType?.trim() ? { mimeType: metadata.mimeType.trim() } : {}),
      ...(typeof metadata?.byteSize === 'number' ? { byteSize: metadata.byteSize } : {}),
      ...(resolvedKind.kind === 'kun-html'
        ? { contentSha256: trustedContentSha256(block) }
        : {})
    }
    const existingIndex = indexByPath.get(key)
    if (existingIndex !== undefined) {
      const existing = artifacts[existingIndex]
      artifacts[existingIndex] = {
        ...existing,
        ...candidate,
        path: preferArtifactPath(existing.path, candidate.path)
      }
      return
    }
    if (artifacts.length >= MAX_PRESENTATION_ARTIFACTS_PER_TURN) return
    indexByPath.set(key, artifacts.length)
    artifacts.push(candidate)
  }

  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status !== 'success') continue
    if (block.toolKind === 'file_change' && block.filePath) add(block, block.filePath)
    for (const file of generatedFilesFrom(block)) {
      const path = generatedFilePath(file)
      if (path) add(block, path, file)
    }
  }

  return artifacts
}

export function presentationFileArtifactsForTurn(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  isProcessing: boolean,
  platform = ''
): PresentationFileArtifact[] {
  return isProcessing ? [] : derivePresentationFileArtifacts(blocks, workspaceRoot, platform)
}
