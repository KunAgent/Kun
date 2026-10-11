const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
const MAX_INLINE_IMAGE_CHARS = 4_000_000
const AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac'])

export function retainedToolBase64(data: unknown): string | undefined {
  if (typeof data !== 'string' || !data.length || data.length > MAX_INLINE_IMAGE_CHARS) return undefined
  const compact = data.replace(/\s/g, '')
  return compact.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact) ? compact : undefined
}

export function toolEvidenceAudio(data: unknown, mimeType: unknown): string | undefined {
  const bytes = retainedToolBase64(data)
  if (!bytes || typeof mimeType !== 'string' || !AUDIO_TYPES.has(mimeType.toLowerCase())) return undefined
  return `data:${mimeType.toLowerCase()};base64,${bytes}`
}

export function toolEvidenceFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value.split(/[/\\]/).pop() ?? '' : ''
  const printable = Array.from(raw, (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char).join('')
  const name = printable.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 120)
  return name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name : 'tool-attachment.bin'
}

/** Only explicit HTTP(S) links can leave the app, and only on user activation. */
export function toolEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch { return undefined }
}

/** Raster bytes may be previewed locally; remote URLs and active SVG never auto-load. */
export function toolEvidenceImage(data: unknown, mimeType: unknown): string | undefined {
  const bytes = retainedToolBase64(data)
  if (!bytes || typeof mimeType !== 'string' || !RASTER_TYPES.has(mimeType.toLowerCase())) return undefined
  return `data:${mimeType.toLowerCase()};base64,${bytes}`
}

export function formatToolEvidence(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value) }
}

export function sliceToolEvidence(text: string, maxLines: number, maxChars: number): {
  text: string; lineCount: number; limited: boolean
} {
  let end = Math.min(text.length, maxChars), lineCount = 1
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    if (lineCount >= maxLines) { end = index; break }
    lineCount += 1
  }
  return { text: text.slice(0, end), lineCount, limited: end < text.length }
}
