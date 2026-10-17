import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { AttachmentContent } from './attachment-store.js'
import type { AttachmentAliases } from '../contracts/attachment-aliases.js'
const root = join(tmpdir(), 'kun-shared-attachments-' + randomUUID())
const maximumBytes = 128 * 1024 * 1024, maximumFiles = 128
const files = new Map<string, { size: number; hash: string }>()
let physicalRoot: string | undefined, mutation = Promise.resolve()
const inside = (base: string, path: string) => { const rel = relative(base, resolve(path)); return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') }
const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx' }
export const sharedAttachmentDirectory = (threadId: string) => join(root, createHash('sha256').update(threadId).digest('hex'))
export function sharedAttachmentName(content: Pick<AttachmentContent, 'id' | 'name' | 'mimeType'>, aliases: AttachmentAliases | undefined) {
  if (aliases === undefined) return content.name
  const raw = aliases.find((alias) => alias.attachmentId === content.id)?.displayName
  // eslint-disable-next-line no-control-regex -- display names replace ASCII controls
  const safe = raw ? basename(raw.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 180).trim() : ''
  return safe && !['.', '..'].includes(safe) ? safe : 'attachment' + (extensions[content.mimeType] ?? '.bin')
}
export function isSharedAttachmentCachePath(path: string) { return inside(root, path) || Boolean(physicalRoot && inside(physicalRoot, path)) }
/** These copies contain only the admitted bytes and opaque IDs, never a deduplicated file's original path/name. */
export async function projectSharedAttachment(content: AttachmentContent, threadId: string, aliases: AttachmentAliases | undefined): Promise<AttachmentContent> {
  if (aliases === undefined) return content
  if (!/^att_[a-f0-9]{24}$/.test(content.id) || content.data.length > 25 * 1024 * 1024) throw new Error('INVALID_SHARED_ATTACHMENT')
  const name = sharedAttachmentName(content, aliases), directory = sharedAttachmentDirectory(threadId)
  const path = join(directory, content.id + (extensions[content.mimeType] ?? '.bin'))
  const hash = createHash('sha256').update(content.data).digest('hex')
  const operation = mutation.then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(root, 0o700); await chmod(directory, 0o700)
    physicalRoot = await realpath(root)
    let valid = false
    try {
      const info = await lstat(path)
      valid = info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size === content.data.length &&
        createHash('sha256').update(await readFile(path)).digest('hex') === hash
    } catch { /* missing or unreadable: rewritten below */ }
    if (!valid) {
      const temporary = join(directory, '.incoming-' + randomUUID())
      try { await writeFile(temporary, content.data, { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
      finally { await rm(temporary, { force: true }).catch(() => {}) }
    }
    await chmod(path, 0o400)
    files.delete(path); files.set(path, { size: content.data.length, hash })
    let bytes = [...files.values()].reduce((sum, entry) => sum + entry.size, 0)
    while (files.size > maximumFiles || bytes > maximumBytes) {
      const oldest = files.entries().next().value!
      if (oldest[0] === path) break
      files.delete(oldest[0]); bytes -= oldest[1].size
      await rm(oldest[0], { force: true }).catch(() => {})
      await rmdir(dirname(oldest[0])).catch(() => {})
    }
  })
  mutation = operation.catch(() => {})
  await operation
  return { ...content, name, localFilePath: path }
}
/** Extra access is limited to one task's private copy directory and never widens ordinary workspace scopes. */
export async function sharedAttachmentReadPath(path: string, context: { threadId: string; attachmentAliases?: AttachmentAliases }) {
  if (context.attachmentAliases === undefined) return null
  const directory = sharedAttachmentDirectory(context.threadId)
  if (!inside(directory, path) && !(physicalRoot && inside(join(physicalRoot, basename(directory)), path))) return null
  const actualRoot = await realpath(root), actualDirectory = await realpath(directory), actual = await realpath(path)
  if (actualDirectory !== join(actualRoot, basename(directory)) || !inside(actualDirectory, actual) ||
    actual !== actualDirectory && (dirname(actual) !== actualDirectory || !/^att_[a-f0-9]{24}\.[a-z0-9]+$/.test(basename(actual))))
    throw new Error('SHARED_ATTACHMENT_PATH_REJECTED')
  if (actual !== actualDirectory) {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('SHARED_ATTACHMENT_PATH_REJECTED')
  }
  physicalRoot = actualRoot
  return actual
}
