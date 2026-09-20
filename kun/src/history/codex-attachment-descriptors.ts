import { basename } from 'node:path'
import { object, string, type JsonObject } from './codex-jsonl.js'

export interface SourceAttachmentMetadata { index: number; name: string; mimeType?: string }
export interface CodexAttachmentDescriptor extends SourceAttachmentMetadata {
  dataUrl?: string
  path?: string
  unavailable?: boolean
}

/** Enumerate declared attachment fields only; never interpret arbitrary tool prose as a file path. */
export function codexAttachmentDescriptors(record: JsonObject): CodexAttachmentDescriptor[] {
  const payload = object(record.payload)
  const found: Omit<CodexAttachmentDescriptor, 'index'>[] = []
  const add = (value: unknown, fallback = 'Codex attachment') => {
    const part = object(value)
    const source = object(part.source)
    const imageUrl = string(part.image_url) || string(object(part.image_url).url)
    const path = string(part.path) || string(part.file_path) || string(part.local_file_path)
    const uri = typeof value === 'string' ? value : imageUrl || string(part.file_data) || string(part.url)
    const mimeType = string(part.mime_type) || string(source.media_type) || undefined
    const dataUrl = uri.startsWith('data:') ? uri
      : source.type === 'base64' && typeof source.data === 'string'
        ? `data:${mimeType ?? 'application/octet-stream'};base64,${source.data}` : undefined
    const local = path || (uri && !/^[a-z][a-z0-9+.-]*:/iu.test(uri) ? uri : undefined)
    found.push({ name: (string(part.filename) || string(part.name) || (local ? basename(local) : fallback)).slice(0, 256),
      ...(mimeType ? { mimeType } : {}), ...(dataUrl ? { dataUrl } : {}), ...(local ? { path: local } : {}),
      ...(!dataUrl && !local ? { unavailable: true } : {}) })
  }
  const parts = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const raw of value) {
      const part = object(raw)
      if (/image|file|audio/iu.test(string(part.type))) add(raw,
        string(part.type).includes('image') ? 'Codex image' : 'Codex attachment')
    }
  }
  parts(payload.content)
  if (Array.isArray(payload.output)) parts(payload.output)
  else if (typeof payload.output === 'string' && ['[', '{'].includes(payload.output.trim().slice(0, 1))) {
    try {
      const decoded: unknown = JSON.parse(payload.output)
      parts(Array.isArray(decoded) ? decoded : object(decoded).content)
    } catch { /* Ordinary tool output is not an attachment declaration. */ }
  }
  for (const name of ['images', 'local_images', 'attachments']) {
    if (Array.isArray(payload[name])) for (const value of payload[name]) add(value, 'Codex image')
  }
  if (payload.type === 'image_generation_call' && typeof payload.result === 'string') {
    const value = payload.result
    add(value.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/iu.test(value)
      ? value : `data:image/png;base64,${value}`, 'Generated image')
  }
  return found.slice(0, 32).map((item, index) => ({ ...item, index }))
}

export function describeCodexAttachments(record: JsonObject): SourceAttachmentMetadata[] {
  return codexAttachmentDescriptors(record).map(({ index, name, mimeType }) => ({
    index, name, ...(mimeType ? { mimeType } : {})
  }))
}
