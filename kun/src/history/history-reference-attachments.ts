import { claudeAttachmentDescriptors } from './claude-projection.js'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import type { HistoryReference } from '../contracts/history-reference.js'
import { readHistorySourceRecord } from './codex-history.js'
import { codexAttachmentDescriptors } from './codex-attachment-descriptors.js'

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
export interface HistoryAttachment { name: string; mimeType: string; dataBase64: string }

/** Resolves bytes only from an attachment declared in a verified frozen source record. */
export async function readHistoryAttachment(
  reference: HistoryReference, itemId: string, attachmentIndex: number
): Promise<HistoryAttachment> {
  const source = await readHistorySourceRecord(reference, itemId)
  if (!source) throw new Error('The source attachment record is unavailable.')
  const attachment = (reference.provider === 'claude-code' ? claudeAttachmentDescriptors : codexAttachmentDescriptors)(source.record).find((item) => item.index === attachmentIndex)
  if (!attachment) throw new Error('The selected source attachment does not exist.')
  let data: Buffer
  if (attachment.dataUrl) data = decodeDataUrl(attachment.dataUrl)
  else if (attachment.path) data = await readLocalAttachment(attachment.path, source.sourcePath, source.workspace)
  else throw new Error('This attachment is unavailable locally. Remote attachment URLs are not fetched.')
  return { name: attachment.name, mimeType: safeMimeType(data, attachment.path ?? attachment.name),
    dataBase64: data.toString('base64') }
}

function decodeDataUrl(value: string): Buffer {
  const match = /^data:[^;,]*;base64,([a-z0-9+/=\r\n]+)$/iu.exec(value)
  if (!match || match[1]!.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 8) {
    throw new Error('The embedded source attachment is invalid or exceeds 16 MiB.')
  }
  const data = Buffer.from(match[1]!, 'base64')
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error('The source attachment exceeds 16 MiB.')
  return data
}

async function readLocalAttachment(path: string, sourcePath: string, workspace: string): Promise<Buffer> {
  const roots = [dirname(sourcePath), ...(isAbsolute(workspace) && workspace !== parse(workspace).root ? [workspace] : [])]
  const canonicalRoots = (await Promise.all(roots.map((root) => realpath(root).catch(() => null))))
    .filter((root): root is string => Boolean(root))
  const candidate = isAbsolute(path) ? path : resolve(workspace || dirname(sourcePath), path)
  const target = await realpath(candidate)
  if (!canonicalRoots.some((root) => isInside(root, target))) {
    throw new Error('The source attachment is outside the source directory and original workspace.')
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('The source attachment is not a regular file under 16 MiB.')
    const data = Buffer.alloc(Math.min(MAX_ATTACHMENT_BYTES + 1, stat.size + 1))
    let total = 0
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total)
      if (!bytesRead) break
      total += bytesRead
      if (total > stat.size || total > MAX_ATTACHMENT_BYTES) throw new Error('The source attachment changed during reading.')
    }
    const after = await handle.stat()
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw new Error('The source attachment changed during reading.')
    }
    return data.subarray(0, total)
  } finally { await handle.close() }
}

function isInside(root: string, path: string): boolean {
  const part = relative(root, path)
  return Boolean(part) && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}

function safeMimeType(data: Buffer, name: string): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a/u.test(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (/\.(?:txt|md|json|jsonl|csv|log|ts|js|py|rs|go|css)$/iu.test(extname(name))) return 'text/plain'
  // Never inline active HTML/SVG or trust MIME declarations from an imported log.
  return 'application/octet-stream'
}
