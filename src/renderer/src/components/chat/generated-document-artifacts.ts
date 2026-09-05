import { PRESENTATION_STUDIO_EXTENSION_ID } from '@shared/presentation-artifact'
import type { ChatBlock, GeneratedFileReference, ToolBlock } from '../../agent/types'

export type GeneratedDocumentKind =
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'kun-html'

export type GeneratedDocumentArtifact = {
  path: string
  name: string
  kind: GeneratedDocumentKind
  extension: string
  mimeType?: string
  byteSize?: number
  contentSha256?: string
}

export type GeneratedDocumentCollection = {
  threadId: string
  turnId: string
  workspaceRoot: string
  files: GeneratedDocumentArtifact[]
}

export const MAX_GENERATED_DOCUMENTS_PER_TURN = 16
export const MAX_INLINE_GENERATED_DOCUMENTS = 2
export const PRESENTATION_STUDIO_ARTIFACT_PRODUCER = PRESENTATION_STUDIO_EXTENSION_ID

const MAX_PATH_LENGTH = 4096
const MAX_NAME_LENGTH = 256
const MAX_MIME_LENGTH = 128

const DOCUMENT_EXTENSION_KINDS: Readonly<Record<string, GeneratedDocumentKind>> = {
  doc: 'word',
  docx: 'word',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  pdf: 'pdf'
}

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

function comparablePath(path: string, platform: string): string {
  return platform === 'win32' ? path.toLowerCase() : path
}

function workspaceRelativePath(path: string, workspaceRoot: string, platform: string): string | null {
  let normalized = collapseCurrentDirectorySegments(path)
  const root = collapseCurrentDirectorySegments(workspaceRoot)
  if (!normalized || hasControlCharacter(normalized) || hasUnsafePathPrefix(normalized)) return null
  if (containsParentTraversal(normalized)) return null
  if (!root || !isAbsolutePath(root) || containsParentTraversal(root)) return null
  if (!isAbsolutePath(normalized)) return normalized

  const comparable = comparablePath(normalized, platform)
  const comparableRoot = comparablePath(root, platform)
  const prefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  if (!comparable.startsWith(prefix)) return null
  normalized = normalized.slice(root.endsWith('/') ? root.length : root.length + 1)
  return normalized || null
}

function artifactPathKey(path: string, workspaceRoot: string, platform: string): string | null {
  const relative = workspaceRelativePath(path, workspaceRoot, platform)
  return relative ? comparablePath(relative, platform) : null
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

function canPublish(block: ToolBlock, kind: GeneratedDocumentKind): boolean {
  return kind !== 'kun-html' ||
    (isTrustedKunHtmlProducer(block) && Boolean(trustedContentSha256(block)))
}

function preferRelativePath(existing: string, candidate: string): string {
  if (!isAbsolutePath(candidate) || isAbsolutePath(existing)) return candidate
  return existing
}

function nameFromPath(path: string): string {
  return normalizeSlashes(path).split('/').filter(Boolean).at(-1) ?? path
}

export function generatedDocumentKindForPath(
  path: string
): { kind: GeneratedDocumentKind; extension: string } | null {
  if (!path.trim() || path.length > MAX_PATH_LENGTH) return null
  const normalized = normalizeSlashes(path).toLowerCase()
  if (normalized.endsWith('.kun-ppt.html')) return { kind: 'kun-html', extension: 'HTML' }
  const name = nameFromPath(normalized)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const extension = name.slice(dot + 1)
  const kind = DOCUMENT_EXTENSION_KINDS[extension]
  return kind ? { kind, extension: extension.toUpperCase() } : null
}

export function isGeneratedDocumentArtifactPath(path: string | undefined): boolean {
  return typeof path === 'string' && generatedDocumentKindForPath(path) !== null
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
  const name = readString('name', 'fileName', 'filename')?.slice(0, MAX_NAME_LENGTH)
  const mimeType = readString('mimeType', 'type', 'mediaType')?.slice(0, MAX_MIME_LENGTH)
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
  return value.map(normalizeGeneratedFile).filter((file): file is GeneratedFileReference => file !== null)
}

export function deriveGeneratedDocumentArtifacts(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  platform = ''
): GeneratedDocumentArtifact[] {
  const artifacts = new Map<string, GeneratedDocumentArtifact>()

  const add = (block: ToolBlock, path: string, metadata?: GeneratedFileReference): void => {
    if (path.length > MAX_PATH_LENGTH) return
    const resolved = generatedDocumentKindForPath(path)
    if (!resolved || !canPublish(block, resolved.kind)) return
    const key = artifactPathKey(path, workspaceRoot, platform)
    if (!key) return
    const existing = artifacts.get(key)
    const candidate: GeneratedDocumentArtifact = {
      path: existing ? preferRelativePath(existing.path, path) : path,
      name: (metadata?.name?.trim() || nameFromPath(path)).slice(0, MAX_NAME_LENGTH),
      kind: resolved.kind,
      extension: resolved.extension,
      ...(metadata?.mimeType?.trim() ? { mimeType: metadata.mimeType.trim() } : {}),
      ...(typeof metadata?.byteSize === 'number' ? { byteSize: metadata.byteSize } : {}),
      ...(resolved.kind === 'kun-html' ? { contentSha256: trustedContentSha256(block) } : {})
    }
    artifacts.delete(key)
    artifacts.set(key, { ...existing, ...candidate })
  }

  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status !== 'success') continue
    if (block.toolKind === 'file_change' && block.filePath) add(block, block.filePath)
    for (const file of generatedFilesFrom(block)) {
      const path = generatedFilePath(file)
      if (path) add(block, path, file)
    }
  }

  return [...artifacts.values()].slice(-MAX_GENERATED_DOCUMENTS_PER_TURN).reverse()
}

export function generatedDocumentArtifactsForTurn(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  isProcessing: boolean,
  platform = ''
): GeneratedDocumentArtifact[] {
  return isProcessing ? [] : deriveGeneratedDocumentArtifacts(blocks, workspaceRoot, platform)
}
