import { useEffect, useMemo, useState } from 'react'
import type { AttachmentReference, GeneratedFileReference } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { readGeneratedWorkspaceImagePreview } from './generated-media-preview'
import {
  useTimelineFilePreviewThreadId,
  useTimelineFilePreviewWorkspaceRoot
} from './timeline-file-preview-workspace'
import {
  attachmentPreviewFailureStateForScope,
  attachmentPreviewLoader,
  type AttachmentPreview,
  type AttachmentPreviewFailureState
} from './attachment-preview-loader'

export type TimelineMediaReference = GeneratedFileReference & {
  id?: string
}

export function readMediaString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function normalizeGeneratedFileReference(entry: unknown): GeneratedFileReference | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const id = readMediaString(raw, 'id', 'attachmentId')
  const artifactId = readMediaString(raw, 'artifactId')
  const mediaHandleId = readMediaString(raw, 'mediaHandleId')
  const ownerExtensionId = readMediaString(raw, 'ownerExtensionId')
  const ownerExtensionVersion = readMediaString(raw, 'ownerExtensionVersion')
  const workspaceId = readMediaString(raw, 'workspaceId')
  const name = readMediaString(raw, 'name', 'fileName', 'filename')
  const mimeType = readMediaString(raw, 'mimeType', 'type', 'mediaType')
  const previewUrl = readMediaString(raw, 'previewUrl', 'dataUrl', 'url')
  const path = readMediaString(raw, 'path', 'file')
  const relativePath = readMediaString(raw, 'relativePath', 'relative_path')
  const absolutePath = readMediaString(raw, 'absolutePath', 'absolute_path')
  const byteSize = typeof raw.byteSize === 'number' && Number.isFinite(raw.byteSize) ? raw.byteSize : undefined
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : undefined
  const height = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : undefined
  const availability = raw.availability === 'available' || raw.availability === 'unavailable'
    ? raw.availability
    : undefined
  const normalized: GeneratedFileReference = {
    ...(id ? { id } : {}),
    ...(artifactId ? { artifactId } : {}),
    ...(mediaHandleId ? { mediaHandleId } : {}),
    ...(availability ? { availability } : {}),
    ...(ownerExtensionId ? { ownerExtensionId } : {}),
    ...(ownerExtensionVersion ? { ownerExtensionVersion } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(byteSize ? { byteSize } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(path ? { path } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(absolutePath ? { absolutePath } : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function metaGeneratedFileReferences(meta: Record<string, unknown> | undefined): GeneratedFileReference[] {
  const value = meta?.generatedFiles
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeGeneratedFileReference(entry))
    .filter((entry): entry is GeneratedFileReference => entry !== null)
}

export function mediaKey(media: TimelineMediaReference): string {
  return (
    media.id ||
    media.absolutePath ||
    media.relativePath ||
    media.path ||
    media.previewUrl ||
    media.name ||
    'media'
  )
}

export function mediaName(media: TimelineMediaReference): string {
  const path = media.relativePath || media.path || media.absolutePath || ''
  const fromPath = path.split(/[\\/]/).filter(Boolean).at(-1)
  return media.name || fromPath || media.id || 'file'
}

export function mediaPath(media: TimelineMediaReference): string | undefined {
  return media.relativePath || media.path || media.absolutePath
}

export function mediaMime(media: TimelineMediaReference): string {
  return media.mimeType?.toLowerCase() ?? ''
}

export function mediaIsImage(media: TimelineMediaReference): boolean {
  const mimeType = mediaMime(media)
  if (mimeType.startsWith('image/')) return true
  return /\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(mediaName(media))
}

export function mediaIsVideo(media: TimelineMediaReference): boolean {
  const mimeType = mediaMime(media)
  if (mimeType.startsWith('video/')) return true
  return /\.(?:mp4|webm|mov|m4v|ogg)$/i.test(mediaName(media))
}

export function formatByteSize(byteSize: number | undefined): string {
  if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = byteSize
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function dataUrlPayload(dataUrl: string | undefined): { dataBase64: string; mimeType?: string } | null {
  if (!dataUrl?.startsWith('data:')) return null
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/)
  if (!match?.[2]) return null
  return {
    dataBase64: match[2],
    ...(match[1] ? { mimeType: match[1] } : {})
  }
}

export function mergeMediaReferences(
  attachments: AttachmentReference[],
  generatedFiles: GeneratedFileReference[]
): TimelineMediaReference[] {
  const media: TimelineMediaReference[] = []
  const indexByKey = new Map<string, number>()
  const indexByName = new Map<string, number>()

  const add = (entry: TimelineMediaReference, allowNameMerge: boolean): void => {
    const key = mediaKey(entry)
    const normalizedName = mediaName(entry).toLowerCase()
    const existingIndex = indexByKey.get(key) ?? (allowNameMerge ? indexByName.get(normalizedName) : undefined)
    if (existingIndex !== undefined) {
      media[existingIndex] = { ...media[existingIndex], ...entry }
      indexByKey.set(mediaKey(media[existingIndex]), existingIndex)
      indexByName.set(mediaName(media[existingIndex]).toLowerCase(), existingIndex)
      return
    }
    indexByKey.set(key, media.length)
    indexByName.set(normalizedName, media.length)
    media.push(entry)
  }

  for (const file of generatedFiles) add(file, false)
  for (const attachment of attachments) add(attachment, true)
  return media
}

export type MediaPreviewRequest = {
  key: string
  id?: string
  path?: string
}

export type GeneratedMediaScrollAvailability = {
  canScrollBackward: boolean
  canScrollForward: boolean
}

export function generatedMediaScrollAvailability({
  scrollLeft,
  clientWidth,
  scrollWidth
}: {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}): GeneratedMediaScrollAvailability {
  const edgeTolerance = 2
  return {
    canScrollBackward: scrollLeft > edgeTolerance,
    canScrollForward: scrollLeft + clientWidth < scrollWidth - edgeTolerance
  }
}

export function isMediaPreviewRequest(entry: MediaPreviewRequest | null): entry is MediaPreviewRequest {
  return entry !== null
}

export function attachmentReferenceFromPreview(
  attachment: AttachmentReference
): AttachmentReference {
  return {
    id: attachment.id,
    ...(attachment.kind ? { kind: attachment.kind } : {}),
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.byteSize ? { byteSize: attachment.byteSize } : {}),
    ...(attachment.width ? { width: attachment.width } : {}),
    ...(attachment.height ? { height: attachment.height } : {})
  }
}

export function useMediaPreviews(
  media: TimelineMediaReference[],
  enabled: boolean
): {
  resolvedPreviews: Record<string, AttachmentPreview>
  failedPreviewIds: Record<string, true>
} {
  const globalActiveThreadId = useChatStore((s) => s.activeThreadId)
  const globalWorkspaceRoot = useChatStore((s) => s.workspaceRoot)
  const timelineThreadId = useTimelineFilePreviewThreadId()
  const timelineWorkspaceRoot = useTimelineFilePreviewWorkspaceRoot()
  const activeThreadId = timelineThreadId || globalActiveThreadId
  const workspaceRoot = timelineWorkspaceRoot || globalWorkspaceRoot
  const scopeKey = JSON.stringify([activeThreadId ?? '', workspaceRoot])
  const [previewFailures, setPreviewFailures] = useState<AttachmentPreviewFailureState>(() => ({
    scopeKey,
    failedPreviewIds: {}
  }))
  const failedPreviewIds = useMemo(
    () => previewFailures.scopeKey === scopeKey
      ? previewFailures.failedPreviewIds
      : {},
    [previewFailures, scopeKey]
  )
  const [previewState, setPreviewState] = useState<{
    scopeKey: string
    resolvedPreviews: Record<string, AttachmentPreview>
  }>(() => ({ scopeKey, resolvedPreviews: {} }))
  const resolvedPreviews = useMemo(
    () => previewState.scopeKey === scopeKey
      ? previewState.resolvedPreviews
      : {},
    [previewState, scopeKey]
  )
  const previewRequests = useMemo(
    () =>
      media
        .map((item) => {
          const key = mediaKey(item)
          if (item.previewUrl || resolvedPreviews[key] || failedPreviewIds[key]) return null
          const id = item.id && !item.artifactId && (
            mediaIsImage(item) || mediaIsVideo(item) || !item.mimeType
          )
            ? item.id
            : undefined
          const path = mediaIsImage(item) ? mediaPath(item) : undefined
          if (!id && !path) return null
          return {
            key,
            ...(id ? { id } : {}),
            ...(path ? { path } : {})
          } satisfies MediaPreviewRequest
        })
        .filter(isMediaPreviewRequest),
    [failedPreviewIds, media, resolvedPreviews]
  )
  const missingPreviewKey = previewRequests
    .map((request) => [
      request.id ? `attachment:${request.id}` : '',
      request.path ? `workspace-image:${request.path}` : ''
    ].filter(Boolean).join('|'))
    .join('\n')

  useEffect(() => {
    if (!enabled || !missingPreviewKey) return
    const provider = getProvider()
    let cancelled = false
    void Promise.all(
      previewRequests.map(async (request) => {
        if (request.id && typeof provider.getAttachmentContent === 'function') {
          try {
            const attachmentId = request.id
            const getAttachmentContent = provider.getAttachmentContent.bind(provider)
            const scope = {
              ...(activeThreadId ? { threadId: activeThreadId } : {}),
              ...(workspaceRoot ? { workspace: workspaceRoot } : {})
            }
            const preview = await attachmentPreviewLoader.load(
              JSON.stringify(['attachment', attachmentId, activeThreadId ?? '', workspaceRoot]),
              async () => {
                const content = await getAttachmentContent(attachmentId, scope)
                return {
                  previewUrl: `data:${content.attachment.mimeType};base64,${content.dataBase64}`,
                  attachment: attachmentReferenceFromPreview(content.attachment)
                }
              }
            )
            return {
              key: request.key,
              preview
            }
          } catch {
            // Generated images also carry a workspace path. Continue to that
            // safe, workspace-bounded source before declaring the tile failed.
          }
        }
        if (request.path && typeof window.kunGui?.readWorkspaceImage === 'function') {
          try {
            const imagePath = request.path
            const readImage = window.kunGui.readWorkspaceImage
            const preview = await attachmentPreviewLoader.load(
              JSON.stringify(['workspace-image', imagePath, activeThreadId ?? '', workspaceRoot]),
              async () => {
                const resolved = await readGeneratedWorkspaceImagePreview({
                  path: imagePath,
                  ...(workspaceRoot ? { workspaceRoot } : {}),
                  readImage
                })
                if (!resolved) throw new Error(`workspace image preview is unavailable: ${imagePath}`)
                return { previewUrl: resolved }
              }
            )
            if (preview.previewUrl) return { key: request.key, preview }
          } catch {
            // The failed state is recorded below only after every available
            // preview source has been exhausted.
          }
        }
        return { key: request.key, failed: true as const }
      })
    ).then((results) => {
      if (cancelled) return
      setPreviewState((current) => {
        const next = current.scopeKey === scopeKey
          ? { ...current.resolvedPreviews }
          : {}
        for (const result of results) {
          if ('preview' in result && result.preview?.previewUrl) {
            next[result.key] = result.preview
          }
        }
        return { scopeKey, resolvedPreviews: next }
      })
      setPreviewFailures((current) => {
        const scoped = attachmentPreviewFailureStateForScope(current, scopeKey)
        const next = { ...scoped.failedPreviewIds }
        for (const result of results) {
          if ('failed' in result) next[result.key] = true
        }
        return { scopeKey, failedPreviewIds: next }
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, enabled, missingPreviewKey, previewRequests, scopeKey, workspaceRoot])

  return { resolvedPreviews, failedPreviewIds }
}

export function userMediaTileClass(mediaCount: number): string {
  const base =
    'group block aspect-[3/2] overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
  if (mediaCount <= 1) {
    return `${base} w-full max-w-[min(100%,20rem)]`
  }
  if (mediaCount <= 3) {
    return `${base} w-[calc((100%-1rem)/3)] max-w-56 shrink-0`
  }
  return `${base} w-[calc((100%-1rem)/3)] max-w-56 shrink-0 snap-start`
}

export type MediaTileNaturalSize = {
  width: number
  height: number
}

export type MediaTileFitConstraints = {
  maxWidth: number
  maxHeight: number
}

// Per-variant fit constraints in px. User tiles keep their existing max
// widths (single: 20rem, multi: 14rem) and add a height cap so tall
// screenshots stay inside the bubble; tool tiles match h-32 w-40 and
// conversation tiles match the w-52 square.
const USER_SINGLE_CONSTRAINTS: MediaTileFitConstraints = { maxWidth: 320, maxHeight: 256 }
const USER_MULTI_CONSTRAINTS: MediaTileFitConstraints = { maxWidth: 224, maxHeight: 160 }
const TOOL_CONSTRAINTS: MediaTileFitConstraints = { maxWidth: 160, maxHeight: 128 }
const CONVERSATION_CONSTRAINTS: MediaTileFitConstraints = { maxWidth: 208, maxHeight: 208 }

export function mediaTileFitConstraints(
  variant: 'user' | 'tool' | 'conversation',
  mediaCount: number
): MediaTileFitConstraints {
  if (variant === 'tool') return TOOL_CONSTRAINTS
  if (variant === 'conversation') return CONVERSATION_CONSTRAINTS
  return mediaCount <= 1 ? USER_SINGLE_CONSTRAINTS : USER_MULTI_CONSTRAINTS
}

// Scales a media tile down to fit the constraints without ever cropping or
// upscaling small images: the container adapts to the image's aspect ratio.
export function mediaTileDisplaySize(
  naturalSize: MediaTileNaturalSize,
  constraints: MediaTileFitConstraints
): MediaTileNaturalSize {
  const naturalWidth = Math.max(1, naturalSize.width)
  const naturalHeight = Math.max(1, naturalSize.height)
  const scale = Math.min(
    1,
    constraints.maxWidth / naturalWidth,
    constraints.maxHeight / naturalHeight
  )
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale)
  }
}
