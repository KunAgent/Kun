import type { ChatBlock, GeneratedFileReference } from '../../agent/types'
import type { DesignImagePlacementTarget } from '../../agent/design-task-profile'
import { isWorkspaceGeneratedImagePath } from '@shared/generated-image-path'
import { isImplicitImageSlot, type CanvasDocument } from './canvas-types'

export type GeneratedImageFallbackTarget = { id: string; imageUrl: string }
export type GeneratedImageResult = {
  imageUrl: string
  completionIdentity: string
  toolBlockId: string
  width?: number
  height?: number
}

const EXISTING_IMAGE_EDIT_PATTERN =
  /(?:按图片批注修改|修改|编辑|改成|改为|改一下|换成?|替换|重画|重绘|修复|调整|变成|去掉|去除|清除|换个颜色|change|edit|modify|replace|transform|restyle|redo|fix|recolor|remove|clean up)/i

export function looksLikeExistingCanvasImageEditRequest(text: string): boolean {
  return EXISTING_IMAGE_EDIT_PATTERN.test(text)
}

export function resolveGeneratedImageFallbackTarget(options: {
  document: CanvasDocument
  selectedIds: ReadonlySet<string>
  userText: string
}): GeneratedImageFallbackTarget | null {
  if (!looksLikeExistingCanvasImageEditRequest(options.userText) || options.selectedIds.size !== 1) {
    return null
  }
  const [id] = [...options.selectedIds]
  if (!id) return null
  const shape = options.document.objects[id]
  if (shape?.type !== 'image' || !shape.imageUrl) return null
  return { id, imageUrl: shape.imageUrl }
}

export function resolveGeneratedImagePlacementTarget(options: {
  document: CanvasDocument
  selectedIds: ReadonlySet<string>
  userText: string
}): DesignImagePlacementTarget | null {
  const editedImage = resolveGeneratedImageFallbackTarget(options)
  if (editedImage) {
    return { shapeId: editedImage.id, expectedImageUrl: editedImage.imageUrl }
  }
  if (options.selectedIds.size !== 1) return null
  const [shapeId] = [...options.selectedIds]
  const shape = shapeId ? options.document.objects[shapeId] : undefined
  if (!shape) return null
  if (shape.aiImageHolder) {
    return shape.imageUrl
      ? { shapeId, expectedImageUrl: shape.imageUrl }
      : { shapeId, expectedHolderKind: 'explicit' }
  }
  if (!isImplicitImageSlot(shape)) return null
  const expectedHolderKind = shape.type === 'image'
    ? 'implicit-image' as const
    : shape.type === 'frame'
      ? 'implicit-frame' as const
      : 'implicit-rect' as const
  return { shapeId, expectedHolderKind }
}

function isGenerateImageToolName(value: unknown): boolean {
  return typeof value === 'string' && (value === 'generate_image' || value.endsWith('__generate_image'))
}

function generatedFileRelativePath(file: unknown): string {
  if (!file || typeof file !== 'object') return ''
  const candidate = file as GeneratedFileReference
  return typeof candidate.relativePath === 'string' && candidate.relativePath.trim()
    ? candidate.relativePath.trim()
    : ''
}

function generatedFileAbsolutePath(file: unknown): string {
  if (!file || typeof file !== 'object') return ''
  const candidate = file as GeneratedFileReference
  return typeof candidate.absolutePath === 'string' && candidate.absolutePath.trim()
    ? candidate.absolutePath.trim()
    : ''
}

function generatedFileImageUrl(file: unknown): string {
  return generatedFileAbsolutePath(file) || generatedFileRelativePath(file)
}

function generatedFileCompletionIdentity(
  blockId: string,
  file: unknown,
  index: number
): string {
  if (!file || typeof file !== 'object') return `${blockId}:file:${index}`
  const candidate = file as GeneratedFileReference
  const explicit = candidate.completionIdentity?.trim()
  if (explicit) return explicit
  const owned = candidate.artifactId?.trim() || candidate.mediaHandleId?.trim() ||
    candidate.id?.trim() || candidate.provenance?.invocationId?.trim() ||
    candidate.provenance?.jobId?.trim()
  if (owned) return owned
  return `${blockId}:${generatedFileImageUrl(candidate) || `file:${index}`}`
}

function isGeneratedImagePath(path: string): boolean {
  return isWorkspaceGeneratedImagePath(path)
}

function latestGeneratedImageMarkdownPath(text: string): string | null {
  let latest: string | null = null
  const re = /!\[[^\]]*]\(([^)\s]+)\)/g
  for (const match of text.matchAll(re)) {
    const path = match[1]?.trim()
    if (path && isGeneratedImagePath(path)) latest = path
  }
  return latest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function generatedImageUrlAliasesForTurn(blocks: readonly ChatBlock[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status !== 'success' ||
      !isGenerateImageToolName(block.meta?.toolName)) continue
    const files = block.meta?.generatedFiles
    if (!Array.isArray(files)) continue
    for (const file of files) {
      const relativePath = generatedFileRelativePath(file)
      const imageUrl = generatedFileImageUrl(file)
      if (relativePath && imageUrl) aliases.set(relativePath, imageUrl)
    }
  }
  return aliases
}

export function rewriteGeneratedImageUrlsForTurn(value: unknown, blocks: readonly ChatBlock[]): unknown {
  const aliases = generatedImageUrlAliasesForTurn(blocks)
  return aliases.size === 0 ? value : rewriteGeneratedImageUrls(value, aliases)
}

function rewriteGeneratedImageUrls(value: unknown, aliases: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteGeneratedImageUrls(item, aliases))
  if (!isRecord(value)) return value
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const rewritten = key === 'imageUrl' && typeof entry === 'string'
      ? aliases.get(entry.trim()) ?? entry
      : rewriteGeneratedImageUrls(entry, aliases)
    if (rewritten !== entry) changed = true
    next[key] = rewritten
  }
  return changed ? next : value
}

export function latestGeneratedImageRelativePathForTurn(blocks: readonly ChatBlock[]): string | null {
  let latest: string | null = null
  for (const block of blocks) {
    if (block.kind === 'assistant') {
      latest = latestGeneratedImageMarkdownPath(block.text) ?? latest
      continue
    }
    if (block.kind !== 'tool' || block.status !== 'success' ||
      !isGenerateImageToolName(block.meta?.toolName)) continue
    const files = block.meta?.generatedFiles
    if (!Array.isArray(files)) continue
    for (const file of files) latest = generatedFileRelativePath(file) || latest
  }
  return latest
}

export function latestGeneratedImageUrlForTurn(blocks: readonly ChatBlock[]): string | null {
  let latest: string | null = null
  for (const block of blocks) {
    if (block.kind === 'assistant') {
      latest = latestGeneratedImageMarkdownPath(block.text) ?? latest
      continue
    }
    if (block.kind !== 'tool' || block.status !== 'success' ||
      !isGenerateImageToolName(block.meta?.toolName)) continue
    const files = block.meta?.generatedFiles
    if (!Array.isArray(files)) continue
    for (const file of files) latest = generatedFileImageUrl(file) || latest
  }
  return latest
}

/** Successful tool results only; assistant markdown is not a completion receipt. */
export function generatedImageResultsForTurn(
  blocks: readonly ChatBlock[]
): GeneratedImageResult[] {
  const results = new Map<string, GeneratedImageResult>()
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status !== 'success' ||
      !isGenerateImageToolName(block.meta?.toolName)) continue
    const files = block.meta?.generatedFiles
    if (!Array.isArray(files)) continue
    files.forEach((file, index) => {
      const imageUrl = generatedFileImageUrl(file)
      if (!imageUrl) return
      const completionIdentity = generatedFileCompletionIdentity(block.id, file, index)
      const candidate = file as GeneratedFileReference
      const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width) &&
        candidate.width > 0 ? candidate.width : undefined
      const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height) &&
        candidate.height > 0 ? candidate.height : undefined
      results.set(completionIdentity, {
        imageUrl,
        completionIdentity,
        toolBlockId: block.id,
        ...(width ? { width } : {}),
        ...(height ? { height } : {})
      })
    })
  }
  return [...results.values()]
}

export function coalesceGeneratedImageAddsForTurn(
  value: unknown,
  blocks: readonly ChatBlock[],
  document: CanvasDocument
): unknown {
  if (!isRecord(value) || !Array.isArray(value.ops)) return value
  const generatedUrls = new Set(
    generatedImageResultsForTurn(blocks).map((result) => result.imageUrl)
  )
  if (generatedUrls.size === 0) return value
  const user = blocks.find((block) => block.kind === 'user')
  const placement = user?.kind === 'user' && isRecord(user.meta?.designImagePlacementTarget)
    ? user.meta.designImagePlacementTarget
    : undefined
  const filledDesignTarget = user?.kind === 'user' && isRecord(user.meta?.designDocumentTarget) &&
    placement && typeof placement.shapeId === 'string' &&
    typeof placement.expectedImageUrl === 'string'
    ? { shapeId: placement.shapeId.trim(), expectedImageUrl: placement.expectedImageUrl.trim() }
    : null
  const existingUrls = new Set(
    Object.values(document.objects)
      .filter((shape) => shape?.type === 'image' && shape.parentId === document.rootId && shape.imageUrl)
      .map((shape) => shape.imageUrl!)
      .filter((url) => generatedUrls.has(url))
  )
  if (existingUrls.size === 0 && !filledDesignTarget) return value
  const ops = value.ops.filter((operation) => {
    if (!isRecord(operation)) return true
    if (operation.op === 'update' && filledDesignTarget && operation.id === filledDesignTarget.shapeId &&
      isRecord(operation.patch)) {
      const imageUrl = typeof operation.patch.imageUrl === 'string'
        ? operation.patch.imageUrl.trim()
        : ''
      if (imageUrl && generatedUrls.has(imageUrl)) return false
    }
    if (operation.op !== 'add' || operation.parentId !== undefined ||
      !isRecord(operation.shape) || operation.shape.type !== 'image') return true
    const imageUrl = typeof operation.shape.imageUrl === 'string'
      ? operation.shape.imageUrl.trim()
      : ''
    if (!imageUrl) return true
    return filledDesignTarget ? !generatedUrls.has(imageUrl) : !existingUrls.has(imageUrl)
  })
  return ops.length === value.ops.length ? value : { ...value, ops }
}
