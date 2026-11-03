import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import type { ArtifactThumbnailRequest, ArtifactThumbnailResult } from '../../shared/artifact-thumbnail'
import { loadSharp } from './lazy-sharp'
import { authorizePrototypePath } from './prototype-embed-registry'
import { resolveWorkspaceFile } from './workspace-file-entries'
import {
  readOfficeDocumentFirstPage,
  renderOfficeHtmlPreview,
  type OfficeDocumentServiceDependencies
} from './office-document-service'

/** Library cards are ~360px wide; 2x for Retina. */
export const ARTIFACT_THUMBNAIL_WIDTH = 720
const DESIGN_VIEWPORT = { width: 1280, height: 800 }
const DESIGN_LOAD_TIMEOUT_MS = 10_000
/** Lets web fonts, CDN styles and first-paint scripts settle before capture. */
const DESIGN_SETTLE_MS = 700
/** Each render is a hidden Chromium page; keep a scrolling grid from spawning dozens. */
const MAX_CONCURRENT_RENDERS = 2

type ResolvedSource = { absolutePath: string; mtimeMs: number; size: number }

export type ArtifactThumbnailDependencies = {
  cacheDir?: string
  office?: OfficeDocumentServiceDependencies
  renderDesign?: (absolutePath: string) => Promise<Buffer>
  renderOffice?: (absolutePath: string) => Promise<Buffer>
}

let activeRenders = 0
const renderWaiters: Array<() => void> = []
const inflight = new Map<string, Promise<ArtifactThumbnailResult>>()

async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => renderWaiters.push(resolve))
  }
  activeRenders += 1
  try {
    return await task()
  } finally {
    activeRenders -= 1
    renderWaiters.shift()?.()
  }
}

function defaultCacheDir(): string {
  return join(app.getPath('userData'), 'artifact-thumbnails')
}

export function artifactThumbnailCacheKey(request: ArtifactThumbnailRequest, source: ResolvedSource): string {
  return createHash('sha256')
    .update([request.source, source.absolutePath, source.mtimeMs, source.size, ARTIFACT_THUMBNAIL_WIDTH].join('\0'))
    .digest('hex')
    .slice(0, 40)
}

async function resolveSource(request: ArtifactThumbnailRequest): Promise<ResolvedSource | string> {
  let absolutePath: string
  if (request.source === 'design-html') {
    const authorized = await authorizePrototypePath(request.path, request.workspaceRoot)
    if (!authorized.ok) return authorized.message
    absolutePath = authorized.absolutePath
  } else {
    const resolved = await resolveWorkspaceFile({ path: request.path, workspaceRoot: request.workspaceRoot })
    if (!resolved.ok) return resolved.message
    absolutePath = resolved.path
  }
  const info = await stat(absolutePath)
  return { absolutePath, mtimeMs: Math.floor(info.mtimeMs), size: info.size }
}

/**
 * Loads a design screen in a hidden, sandboxed window at desktop size and
 * captures the first viewport. Scripts run (design screens often need them),
 * but the page cannot open windows, navigate away or ask for permissions.
 */
async function renderDesignHtml(absolutePath: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    width: DESIGN_VIEWPORT.width,
    height: DESIGN_VIEWPORT.height,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      partition: 'kun-artifact-thumbnails'
    }
  })
  try {
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setAudioMuted(true)
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      window.loadURL(pathToFileURL(absolutePath).toString()),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, DESIGN_LOAD_TIMEOUT_MS) })
    ]).finally(() => clearTimeout(timer))
    await contents.executeJavaScript(
      `Promise.resolve(document.fonts && document.fonts.ready).then(() => new Promise((r) => setTimeout(r, ${DESIGN_SETTLE_MS})))`
    ).catch(() => undefined)
    const image = await contents.capturePage({ x: 0, y: 0, ...DESIGN_VIEWPORT })
    return image.toPNG()
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

const OFFICE_TRIM_GROUND = '#c8c8cc'

/** OfficeCLI's own viewer chrome: file name, slide rail, slide label and page counter. */
const OFFICE_VIEWER_CHROME_CSS = [
  '.sidebar,.sidebar-toggle,.toggle-zone,.file-title,.slide-label,.page-counter{display:none!important}',
  // A flat grey ground that the trim step removes, leaving the white page or slide.
  `html,body{margin:0!important;background:${OFFICE_TRIM_GROUND}!important}`,
  '.main{margin:0!important;padding:0!important}',
  // Without OfficeCLI's sizing script a slide collapses to its text; restore its aspect ratio.
  '.slide{background-color:#fff;height:auto!important;aspect-ratio:var(--slide-aspect,1.7778)}'
].join('')

export function withoutOfficeViewerChrome(html: string): string {
  const style = `<style>${OFFICE_VIEWER_CHROME_CSS}</style>`
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`
}

async function renderOfficeFirstPage(absolutePath: string, dependencies: OfficeDocumentServiceDependencies): Promise<Buffer> {
  // A custom renderer also keeps these captures out of the viewer's shared preview cache.
  const result = await readOfficeDocumentFirstPage({ path: absolutePath }, {
    ...dependencies,
    renderHtml: dependencies.renderHtml ?? ((html) => renderOfficeHtmlPreview(withoutOfficeViewerChrome(html)))
  })
  if (!result.ok) throw new Error(result.message)
  if (!result.visualPreview) throw new Error(result.previewUnavailableReason || 'No visual preview for this document.')
  const capture = Buffer.from(result.visualPreview.dataBase64, 'base64')
  // OfficeCLI pages sit on a flat viewer margin; trim it so the page fills the card.
  return (await loadSharp())(capture).trim({ background: OFFICE_TRIM_GROUND, threshold: 12 }).png().toBuffer().catch(() => capture)
}

async function encodeThumbnail(image: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = await loadSharp()
  const resized = await sharp(image).resize({ width: ARTIFACT_THUMBNAIL_WIDTH, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  // Tall documents keep only their top: cards show the start of the page.
  const height = Math.min(resized.info.height, Math.round(resized.info.width * 1.4))
  const output = await sharp(resized.data)
    .extract({ left: 0, top: 0, width: resized.info.width, height })
    .webp({ quality: 80, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { data: output.data, width: output.info.width, height: output.info.height }
}

function toResult(data: Buffer, width: number, height: number): ArtifactThumbnailResult {
  return { ok: true, dataUrl: `data:image/webp;base64,${data.toString('base64')}`, width, height }
}

async function readCached(path: string): Promise<ArtifactThumbnailResult | null> {
  try {
    const data = await readFile(path)
    const meta = await (await loadSharp())(data).metadata()
    return toResult(data, meta.width ?? ARTIFACT_THUMBNAIL_WIDTH, meta.height ?? 0)
  } catch {
    return null
  }
}

/**
 * A still image of a design screen or an Office document's first page, cached
 * on disk by path, size and modification time so an unchanged file renders once.
 */
export async function renderArtifactThumbnail(
  request: ArtifactThumbnailRequest,
  dependencies: ArtifactThumbnailDependencies = {}
): Promise<ArtifactThumbnailResult> {
  let source: ResolvedSource | string
  try {
    source = await resolveSource(request)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (typeof source === 'string') return { ok: false, message: source }
  const resolved = source
  const cacheDir = dependencies.cacheDir ?? defaultCacheDir()
  const key = artifactThumbnailCacheKey(request, resolved)
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async (): Promise<ArtifactThumbnailResult> => {
    const cachePath = join(cacheDir, `${key}.webp`)
    const cached = await readCached(cachePath)
    if (cached) return cached
    try {
      const png = await withRenderSlot(() => request.source === 'design-html'
        ? (dependencies.renderDesign ?? renderDesignHtml)(resolved.absolutePath)
        : (dependencies.renderOffice ?? ((path) => renderOfficeFirstPage(path, dependencies.office ?? {})))(resolved.absolutePath))
      const encoded = await encodeThumbnail(png)
      await mkdir(cacheDir, { recursive: true })
      const temporary = `${cachePath}.${process.pid}.tmp`
      await writeFile(temporary, encoded.data)
      await rename(temporary, cachePath)
      return toResult(encoded.data, encoded.width, encoded.height)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}
