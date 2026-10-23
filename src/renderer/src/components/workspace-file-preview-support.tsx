import {
  lazy,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement
} from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { harden } from 'rehype-harden'
import rehypeRaw from 'rehype-raw'
import type { PluggableList } from 'unified'
import { workspaceFileTargetKey } from '../lib/workspace-file-target-key'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import {
  initialWriteMarkdownImageSrc,
  loadWriteMarkdownImage
} from '../write/markdown-image'

export const WorkspacePdfViewer = lazy(async () => {
  const module = await import('./write/WritePdfViewer')
  return { default: module.WritePdfViewer }
})

export type Props = {
  target: WorkspaceFileTarget | null
  openTargets?: WorkspaceFileTarget[]
  workspaceRoot: string
  className?: string
  fileTreeOpen?: boolean
  onToggleFileTree?: () => void
  onSelectTarget?: (target: WorkspaceFileTarget) => void
  onCloseTarget?: (target: WorkspaceFileTarget) => void
  pinnedTargetKeys?: string[]
  preserveAcrossThreads?: boolean
  onTogglePinnedTarget?: (target: WorkspaceFileTarget) => void
  onCloseOtherTargets?: (target: WorkspaceFileTarget) => void
  onTogglePreserveAcrossThreads?: () => void
  onClose: () => void
  /** The host draws the open-file tabs; the preview keeps only its toolbar. */
  hostTabs?: import('./workspace-file-preview-host-tabs').FilePreviewHostTabsBridge
}

export type CachedTextDraft = {
  content: string
  baseContent: string
  mtimeMs?: number
}

export const COPY_RESET_MS = 1400
export const MARKDOWN_DEFAULT_ORIGIN = 'https://kun.local'
export const PREVIEW_SCROLL_POSITIONS_KEY = 'kun.issue781.previewScrollPositions'
export const MAX_PREVIEW_SCROLL_POSITIONS = 200
export const markdownRehypePlugins = [
  rehypeRaw,
  [
    harden,
    {
      defaultOrigin: MARKDOWN_DEFAULT_ORIGIN,
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: ['*']
    }
  ]
] as unknown as PluggableList

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

export function splitPath(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean)
}

export function relativePathSegments(path: string, workspaceRoot: string): string[] {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return splitPath(normalizedPath.slice(normalizedRoot.length + 1))
  }
  return [fileNameFromPath(path)]
}

export function extensionBadge(path: string, language: string): string {
  const fileName = fileNameFromPath(path)
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const value = ext || language || 'txt'
  return value.slice(0, 3).toUpperCase()
}

export function targetKey(
  target: WorkspaceFileTarget | null | undefined,
  platform?: string
): string {
  return workspaceFileTargetKey(target, platform)
}

export function isAbsolutePreviewPath(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:[/\\]/i.test(path) || /^[/\\]{2}[^/\\]/.test(path)
}

export function resolvedPreviewPathMatchesTarget(
  resolvedPath: string,
  target: WorkspaceFileTarget,
  defaultWorkspaceRoot: string,
  platform?: string
): boolean {
  const workspaceRoot = target.workspaceRoot ?? defaultWorkspaceRoot
  const requestedPath = isAbsolutePreviewPath(target.path)
    ? target.path
    : `${workspaceRoot.replace(/[/\\]+$/, '')}/${target.path}`
  return targetKey({ path: resolvedPath, workspaceRoot }, platform) ===
    targetKey({ path: requestedPath, workspaceRoot }, platform)
}

export function nextFilePreviewTargetForWheel(
  targets: WorkspaceFileTarget[],
  activeTarget: WorkspaceFileTarget | null,
  delta: number
): WorkspaceFileTarget | null {
  if (targets.length < 2 || delta === 0) return null
  const activeKey = targetKey(activeTarget)
  const activeIndex = targets.findIndex((item) => targetKey(item) === activeKey)
  const startIndex = activeIndex >= 0 ? activeIndex : 0
  return targets[(startIndex + (delta > 0 ? 1 : -1) + targets.length) % targets.length] ?? null
}

export function rememberPreviewScrollPosition(
  positions: Record<string, number>,
  key: string,
  scrollTop: number
): Record<string, number> {
  if (!key || !Number.isFinite(scrollTop)) return positions
  const next = { ...positions }
  delete next[key]
  next[key] = Math.max(0, scrollTop)
  return Object.fromEntries(Object.entries(next).slice(-MAX_PREVIEW_SCROLL_POSITIONS))
}

export function parsePreviewScrollPositions(raw: string | null, platform = ''): Record<string, number> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const entries = Object.entries(value).flatMap(([key, scrollTop]): Array<[string, number]> => {
      if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop < 0) return []
      const parts = key.replaceAll('\\', '/').split('\n')
      if (parts.length === 2 && parts[1]) {
        return [[workspaceFileTargetKey({ workspaceRoot: parts[0], path: parts[1] }, platform), scrollTop]]
      }
      if (platform === 'win32' && parts.length === 3 && parts[2]) {
        return [[workspaceFileTargetKey({ workspaceRoot: parts[1], path: parts[2] }, platform), scrollTop]]
      }
      return []
    })
    return Object.fromEntries(entries.slice(-MAX_PREVIEW_SCROLL_POSITIONS))
  } catch {
    return {}
  }
}

export function readPreviewScrollPositions(): Record<string, number> {
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  return parsePreviewScrollPositions(readBrowserStorageItem(PREVIEW_SCROLL_POSITIONS_KEY), platform)
}

export function persistPreviewScrollPositions(positions: Record<string, number>): void {
  writeBrowserStorageItem(
    PREVIEW_SCROLL_POSITIONS_KEY,
    JSON.stringify(Object.fromEntries(Object.entries(positions).slice(-MAX_PREVIEW_SCROLL_POSITIONS)))
  )
}

export function isMarkdownPreviewPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

export function isSvgPreviewPath(path: string): boolean {
  return /\.svg$/i.test(path)
}

export function isJsonPreviewPath(path: string): boolean {
  return /\.json$/i.test(path)
}

export function svgPreviewDataUrl(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
}

export function normalizePreviewImageSrc(src: string | undefined): string | undefined {
  if (!src?.startsWith(`${MARKDOWN_DEFAULT_ORIGIN}/`)) return src

  try {
    const url = new URL(src)
    if (url.origin !== MARKDOWN_DEFAULT_ORIGIN) return src
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return src
  }
}

export type ResolvedPreviewImageProps = {
  src?: string
  alt?: string | null
  filePath?: string | null
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

export function ResolvedPreviewImage({
  src,
  alt,
  filePath,
  ...props
}: ResolvedPreviewImageProps): ReactElement {
  const normalizedSrc = normalizePreviewImageSrc(src)
  const [resolvedSrc, setResolvedSrc] = useState(() => initialWriteMarkdownImageSrc(normalizedSrc, filePath))
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setResolvedSrc(initialWriteMarkdownImageSrc(normalizedSrc, filePath))

    void loadWriteMarkdownImage(normalizedSrc, filePath).then((next) => {
      if (cancelled) return
      if (next.ok) {
        setResolvedSrc(next.src)
      } else {
        setLoadError(next.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [normalizedSrc, filePath])

  if (loadError) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        title={loadError}
      >
        {alt || src || 'Image could not be loaded'}
      </span>
    )
  }

  if (!resolvedSrc) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted"
        title={src}
      >
        {alt || src || 'Image'}
      </span>
    )
  }

  return <img {...props} src={resolvedSrc} alt={alt ?? ''} />
}
