import type { ChatBlock, GeneratedFileReference } from '../../agent/types'
import type { CanvasDocument } from './canvas-types'

export type GeneratedImageFallbackTarget = { id: string; imageUrl: string }

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

function latestGeneratedImageMarkdownPath(text: string): string | null {
  let latest: string | null = null
  const re = /!\[[^\]]*]\(([^)\s]+)\)/g
  for (const match of text.matchAll(re)) {
    const path = match[1]?.trim()
    if (path?.startsWith('.deepseekgui-images/')) latest = path
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
