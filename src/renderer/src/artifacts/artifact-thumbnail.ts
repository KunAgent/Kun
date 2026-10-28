import { useEffect, useState } from 'react'
import { loadBoardPreview } from './artifact-board-preview'
import { loadDesignScreens } from './artifact-design-screens'
import type { LibraryArtifact } from './artifact-types'

/** What a library card shows above its title. */
export type ArtifactThumbnail =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'image'; url: string }
  /** Several design screens laid out like a small canvas. */
  | { status: 'screens'; urls: string[]; total: number }
  /** The first rows of a CSV file. */
  | { status: 'table'; rows: string[][] }

export const MAX_THUMBNAIL_SCREENS = 6
const CSV_ROWS = 8
const CSV_COLUMNS = 6
const PDF_THUMBNAIL_WIDTH = 720
const OFFICE_THUMBNAIL_EXTS = new Set(['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'])

const cache = new Map<string, ArtifactThumbnail>()
const CACHE_LIMIT = 120

function cacheKey(artifact: LibraryArtifact): string {
  return `${artifact.id}:${artifact.updatedAt}`
}

function remember(key: string, thumbnail: ArtifactThumbnail): ArtifactThumbnail {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, thumbnail)
  return thumbnail
}

async function renderedThumbnail(
  artifact: LibraryArtifact,
  path: string,
  source: 'design-html' | 'office'
): Promise<string> {
  const result = await window.kunGui?.renderArtifactThumbnail?.({ workspaceRoot: artifact.workspaceRoot, path, source })
    .catch(() => null)
  return result?.ok ? result.dataUrl : ''
}

async function loadDesignThumbnail(artifact: LibraryArtifact): Promise<ArtifactThumbnail> {
  const screens = await loadDesignScreens(artifact)
  const urls = (await Promise.all(screens.slice(0, MAX_THUMBNAIL_SCREENS)
    .map((screen) => renderedThumbnail(artifact, screen.relativePath ?? '', 'design-html'))))
    .filter(Boolean)
  if (urls.length === 0) return { status: 'empty' }
  if (screens.length === 1) return { status: 'image', url: urls[0] }
  return { status: 'screens', urls, total: screens.length }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function loadPdfThumbnail(artifact: LibraryArtifact): Promise<string> {
  const read = await window.kunGui?.readWorkspacePdf?.({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
    .catch(() => null)
  if (!read?.ok) return ''
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.mjs?url')
  ])
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await getDocument({ data: bytesFromBase64(read.dataBase64), isEvalSupported: false }).promise
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PDF_THUMBNAIL_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/webp', 0.82)
  } finally {
    void pdf.destroy()
  }
}

/** A tolerant CSV split for a preview: quoted fields, commas inside quotes, CRLF. */
export function parseCsvPreview(text: string, maxRows = CSV_ROWS, maxColumns = CSV_COLUMNS): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length && rows.length < maxRows; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); field = ''
      if (row.some((cell) => cell.trim())) rows.push(row.slice(0, maxColumns))
      row = []
    } else field += char
  }
  if (rows.length < maxRows && (field || row.length > 0)) {
    row.push(field)
    if (row.some((cell) => cell.trim())) rows.push(row.slice(0, maxColumns))
  }
  return rows
}

async function loadCsvThumbnail(artifact: LibraryArtifact): Promise<ArtifactThumbnail> {
  const read = await window.kunGui?.readWorkspaceFile?.({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
    .catch(() => null)
  const rows = read?.ok ? parseCsvPreview(read.content) : []
  return rows.length > 0 ? { status: 'table', rows } : { status: 'empty' }
}

async function loadImageThumbnail(artifact: LibraryArtifact): Promise<string> {
  const result = await window.kunGui?.readWorkspaceImage?.({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
    .catch(() => null)
  return result?.ok ? result.dataUrl : ''
}

function asImage(url: string): ArtifactThumbnail {
  return url ? { status: 'image', url } : { status: 'empty' }
}

export async function loadArtifactThumbnail(artifact: LibraryArtifact): Promise<ArtifactThumbnail> {
  const ext = artifact.ext.toLowerCase()
  switch (artifact.kind) {
    case 'image': return asImage(await loadImageThumbnail(artifact))
    case 'board': return asImage(await loadBoardPreview(artifact))
    case 'design': return loadDesignThumbnail(artifact)
    default:
      if (ext === '.pdf') return asImage(await loadPdfThumbnail(artifact))
      if (ext === '.csv') return loadCsvThumbnail(artifact)
      if (OFFICE_THUMBNAIL_EXTS.has(ext)) return asImage(await renderedThumbnail(artifact, artifact.path, 'office'))
      return { status: 'empty' }
  }
}

/** Loads a card's thumbnail once per artifact version; callers mount it only when the card is visible. */
export function useArtifactThumbnail(artifact: LibraryArtifact): ArtifactThumbnail {
  const key = cacheKey(artifact)
  const [state, setState] = useState<{ key: string; thumbnail: ArtifactThumbnail }>(() =>
    ({ key, thumbnail: cache.get(key) ?? { status: 'loading' } }))
  useEffect(() => {
    const cached = cache.get(key)
    if (cached) { setState({ key, thumbnail: cached }); return }
    let cancelled = false
    setState({ key, thumbnail: { status: 'loading' } })
    void loadArtifactThumbnail(artifact)
      .catch((): ArtifactThumbnail => ({ status: 'empty' }))
      .then((thumbnail) => {
        // Board previews own a blob-URL cache that revokes on eviction; never outlive it.
        if (artifact.kind !== 'board') remember(key, thumbnail)
        if (!cancelled) setState({ key, thumbnail })
      })
    return () => { cancelled = true }
  }, [artifact, key])
  return state.key === key ? state.thumbnail : { status: 'loading' }
}
