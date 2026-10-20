/**
 * Picks a viewer for a workspace file. Only formats with a dedicated viewer
 * are chosen by name; every other file opens as text first and the main
 * process decides from its bytes whether it is really binary.
 */
const VIEWER_BY_EXTENSION: Record<string, WorkspaceFilePreviewKind> = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.csv': 'table',
  '.tsv': 'table',
  '.pdf': 'pdf'
}

const RASTER_IMAGE_PREVIEW_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp'
])

/** Decoded by the main process into a PNG copy. */
const CONVERTED_IMAGE_PREVIEW_EXTENSIONS = new Set(['.heic', '.heif', '.tif', '.tiff'])
const OFFICE_PREVIEW_EXTENSIONS = new Set(['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'])
const AUDIO_PREVIEW_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav'])
const VIDEO_PREVIEW_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.ogv', '.webm'])

/** Never worth reading as text: the preview goes straight to the binary card. */
const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.apk', '.avi', '.bin', '.bz2', '.class', '.db', '.dll', '.dmg', '.dylib', '.exe', '.gguf',
  '.gz', '.icns', '.iso', '.jar', '.lib', '.mkv', '.msi', '.o', '.obj', '.onnx', '.parquet', '.pkg', '.psd',
  '.pt', '.pyc', '.rar', '.safetensors', '.so', '.sqlite', '.sqlite3', '.tar', '.tgz', '.ttf', '.otf',
  '.wasm', '.woff', '.woff2', '.xz', '.zip', '.zst'
])

export type WorkspaceFilePreviewKind =
  | 'text'
  | 'markdown'
  | 'json'
  | 'html'
  | 'svg'
  | 'table'
  | 'image'
  | 'pdf'
  | 'office'
  | 'audio'
  | 'video'
  | 'binary'

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? path
}

function extension(path: string): string {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

export function isWorkspaceRasterImagePreviewPath(path: string): boolean {
  const ext = extension(path)
  return Boolean(ext && (RASTER_IMAGE_PREVIEW_EXTENSIONS.has(ext) || CONVERTED_IMAGE_PREVIEW_EXTENSIONS.has(ext)))
}

export function isWorkspaceConvertedImagePath(path: string): boolean {
  return CONVERTED_IMAGE_PREVIEW_EXTENSIONS.has(extension(path))
}

export function workspaceFilePreviewKind(path: string): WorkspaceFilePreviewKind {
  const ext = extension(path)
  const viewer = VIEWER_BY_EXTENSION[ext]
  if (viewer) return viewer
  if (isWorkspaceRasterImagePreviewPath(path)) return 'image'
  if (OFFICE_PREVIEW_EXTENSIONS.has(ext)) return 'office'
  if (AUDIO_PREVIEW_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_PREVIEW_EXTENSIONS.has(ext)) return 'video'
  if (KNOWN_BINARY_EXTENSIONS.has(ext)) return 'binary'
  return 'text'
}

/** Every file has a preview: text, a dedicated viewer, or the binary card. */
export function isWorkspacePreviewPath(path: string): boolean {
  return Boolean(basename(path))
}

/** Text-backed kinds that go through `readWorkspaceFile`. */
export function isWorkspaceTextBackedPreviewKind(kind: WorkspaceFilePreviewKind): boolean {
  return kind === 'text' || kind === 'markdown' || kind === 'json' || kind === 'html' || kind === 'svg' || kind === 'table'
}
