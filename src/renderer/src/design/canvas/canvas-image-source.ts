import { useEffect, useState } from 'react'
import { useCanvasWorkspaceRoot } from './canvas-workspace-context'

const DIRECT_URL_RE = /^(data:|https?:|blob:)/i
const ABSOLUTE_LOCAL_PATH_RE = /^(\/|[A-Za-z]:[\\/]|\\\\)/
const LOAD_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const
const DEFAULT_IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_IMAGE_CACHE_MAX_ENTRIES = 128

type ImageCacheEntry = {
  workspaceRoot: string
  dataUrl: string
  bytes: number
}

function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return dataUrl.length * 2
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (/;base64$/i.test(header)) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor(payload.length * 3 / 4) - padding)
  }
  return payload.length * 2
}

function normalizeImageWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

export class CanvasImageDataUrlCache {
  private readonly entries = new Map<string, ImageCacheEntry>()
  private totalBytes = 0

  constructor(
    private readonly maxBytes = DEFAULT_IMAGE_CACHE_MAX_BYTES,
    private readonly maxEntries = DEFAULT_IMAGE_CACHE_MAX_ENTRIES
  ) {}

  get(key: string): string | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.dataUrl
  }

  set(key: string, workspaceRoot: string, dataUrl: string): void {
    const bytes = dataUrlByteSize(dataUrl)
    const existing = this.entries.get(key)
    if (existing) {
      this.totalBytes -= existing.bytes
      this.entries.delete(key)
    }
    if (bytes > this.maxBytes || this.maxBytes <= 0 || this.maxEntries <= 0) return
    this.entries.set(key, { workspaceRoot: normalizeImageWorkspaceRoot(workspaceRoot), dataUrl, bytes })
    this.totalBytes += bytes
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      const oldest = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)
      if (oldest) this.totalBytes -= oldest.bytes
    }
  }

  clear(workspaceRoot?: string): void {
    if (workspaceRoot === undefined) {
      this.entries.clear()
      this.totalBytes = 0
      return
    }
    for (const [key, entry] of this.entries) {
      if (entry.workspaceRoot !== normalizeImageWorkspaceRoot(workspaceRoot)) continue
      this.entries.delete(key)
      this.totalBytes -= entry.bytes
    }
  }

  stats(workspaceRoot?: string): { entries: number; bytes: number } {
    if (workspaceRoot === undefined) {
      return { entries: this.entries.size, bytes: this.totalBytes }
    }
    let entries = 0
    let bytes = 0
    for (const entry of this.entries.values()) {
      if (entry.workspaceRoot !== normalizeImageWorkspaceRoot(workspaceRoot)) continue
      entries += 1
      bytes += entry.bytes
    }
    return { entries, bytes }
  }
}

const cache = new CanvasImageDataUrlCache()

function cacheKey(workspaceRoot: string, path: string): string {
  return `${normalizeImageWorkspaceRoot(workspaceRoot)}::${path.trim().replaceAll('\\', '/')}`
}

export function isDirectImageUrl(url: string): boolean {
  return DIRECT_URL_RE.test(url)
}

export function isAbsoluteLocalImagePath(url: string): boolean {
  return ABSOLUTE_LOCAL_PATH_RE.test(url.trim())
}

async function readImageDataUrl(
  workspaceRoot: string,
  path: string
): Promise<string | null> {
  if (typeof window.kunGui?.readWorkspaceImage !== 'function') return null
  const result = await window.kunGui.readWorkspaceImage({
    path,
    ...(workspaceRoot ? { workspaceRoot } : {})
  })
  return result.ok ? result.dataUrl : null
}

async function resolveWorkspaceImage(
  workspaceRoot: string,
  path: string,
  key: string
): Promise<string | null> {
  const hit = cache.get(key)
  if (hit) return hit
  const trimmedPath = path.trim()
  if (!trimmedPath || typeof window.kunGui?.readWorkspaceImage !== 'function') return null
  try {
    const dataUrl = isAbsoluteLocalImagePath(trimmedPath)
      ? await readImageDataUrl('', trimmedPath)
      : await readImageDataUrl(workspaceRoot, trimmedPath)
  if (dataUrl) {
      cache.set(key, workspaceRoot, dataUrl)
      return dataUrl
    }
  } catch {
    // fall through to failure
  }
  return null
}

/**
 * Context-free resolver: turn a shape `imageUrl` into a renderable URL without
 * the `CanvasWorkspaceContext` (used by surfaces mounted outside the canvas,
 * e.g. the full-screen annotation editor). Direct URLs pass through; a
 * workspace-relative path is loaded via IPC and cached. Returns null on failure.
 */
export async function loadWorkspaceImageDataUrl(
  workspaceRoot: string,
  imageUrl: string | undefined
): Promise<string | null> {
  if (!imageUrl) return null
  if (isDirectImageUrl(imageUrl)) return imageUrl
  return resolveWorkspaceImage(workspaceRoot, imageUrl, cacheKey(workspaceRoot, imageUrl))
}

export function clearWorkspaceImageDataUrlCache(workspaceRoot?: string): void {
  cache.clear(workspaceRoot)
}

export function workspaceImageDataUrlCacheStats(workspaceRoot?: string): {
  entries: number
  bytes: number
} {
  return cache.stats(workspaceRoot)
}

/**
 * Resolve a shape's `imageUrl` into something an SVG `<image>` can render.
 * Direct URLs (`data:`/`http(s):`/`blob:`) pass through untouched; a
 * workspace-relative path (e.g. `.kun/images/img-*.png`) is loaded once
 * via `readWorkspaceImage` and cached. Returns null while loading or on failure
 * so the caller can show its placeholder.
 */
export function useWorkspaceImageSrc(imageUrl: string | undefined): string | null {
  const workspaceRoot = useCanvasWorkspaceRoot()
  const direct = imageUrl && isDirectImageUrl(imageUrl) ? imageUrl : null
  const [resolved, setResolved] = useState<string | null>(() =>
    imageUrl && !direct ? cache.get(cacheKey(workspaceRoot, imageUrl)) : null
  )

  useEffect(() => {
    if (!imageUrl || direct) {
      setResolved(null)
      return
    }
    const key = cacheKey(workspaceRoot, imageUrl)
    const hit = cache.get(key)
    if (hit) {
      setResolved(hit)
      return
    }
    setResolved(null)
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (index: number): void => {
      void resolveWorkspaceImage(workspaceRoot, imageUrl, key).then((url) => {
        if (!active) return
        if (url) {
          setResolved(url)
          return
        }
        const nextDelay = LOAD_RETRY_DELAYS_MS[index + 1]
        if (nextDelay === undefined) {
          setResolved(null)
          return
        }
        timer = setTimeout(() => attempt(index + 1), nextDelay)
      })
    }
    attempt(0)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [workspaceRoot, imageUrl, direct])

  return direct ?? resolved
}
