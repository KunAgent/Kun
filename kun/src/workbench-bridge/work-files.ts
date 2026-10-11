import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, realpath, rename, stat, writeFile, lstat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import type { WorkbenchEdit } from '../contracts/workbench-links.js'
import { pathWithin } from './directory.js'

/** Formats the Work editor opens; only plain-text ones can be read or edited here. */
export const WORK_TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.html', '.htm', '.tex', '.rst', '.org'])
export const WORK_DOCUMENT_EXTENSIONS = new Set([...WORK_TEXT_EXTENSIONS, '.docx', '.xlsx', '.pptx', '.pdf'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache'])
const MAX_EDITABLE_BYTES = 512 * 1024

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

/** A relative path with no traversal, drive letters, backslashes or hidden segments. */
export function assertRelativeWorkPath(value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value)) {
    throw new Error('relativePath must be a plain relative path inside the workspace')
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('relativePath cannot contain empty, dot or hidden segments')
  }
  return parts.join('/')
}

/** Whether the (validated) relative path already names something inside the workspace. */
export async function workFileExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await lstat(resolve(await realpath(root), assertRelativeWorkPath(relativePath)))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
}

/** Resolve an existing regular file strictly inside `root`; symlinks may not lead out. */
export async function resolveWorkFile(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root)
  const real = await realpath(resolve(realRoot, assertRelativeWorkPath(relativePath)))
  if (!pathWithin(realRoot, real)) throw new Error('document is outside the workspace')
  if (!(await stat(real)).isFile()) throw new Error('not a regular file')
  return real
}

export type WorkTextPage = { text: string; offset: number; nextOffset?: number; totalChars: number; sha256: string; bytes: number }

/** Read a text document in bounded character pages, with the hash of the whole file. */
export async function readWorkText(root: string, relativePath: string, offset: number, pageChars: number): Promise<WorkTextPage> {
  const path = await resolveWorkFile(root, relativePath)
  if (!WORK_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('This document format cannot be read as text; ask the user to open it in Work')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (info.size > MAX_EDITABLE_BYTES * 4) throw new Error('document is too large to read here')
    const data = Buffer.alloc(info.size)
    await handle.read(data, 0, data.length, 0)
    if (data.includes(0)) throw new Error('document is not plain text')
    const text = data.toString('utf8')
    const end = Math.min(text.length, offset + pageChars)
    return { text: text.slice(offset, end), offset, ...(end < text.length ? { nextOffset: end } : {}),
      totalChars: text.length, sha256: sha256(data), bytes: data.length }
  } finally { await handle.close() }
}

/** Apply exact-match edits in order. Each `oldText` must occur exactly once in the running text. */
export function applyWorkEdits(text: string, edits: readonly WorkbenchEdit[]): string {
  let next = text
  edits.forEach((edit, index) => {
    const first = next.indexOf(edit.oldText)
    if (first < 0) throw new Error(`edit ${index + 1}: oldText was not found; read the document again and copy the text exactly`)
    if (next.indexOf(edit.oldText, first + 1) >= 0) throw new Error(`edit ${index + 1}: oldText matches more than once; include more surrounding text`)
    next = next.slice(0, first) + edit.newText + next.slice(first + edit.oldText.length)
  })
  return next
}

/** Create a new document. Never overwrites, never leaves the workspace. */
export async function createWorkFile(root: string, relativePath: string, content: string): Promise<string> {
  const rel = assertRelativeWorkPath(relativePath)
  if (!WORK_DOCUMENT_EXTENSIONS.has(extname(rel).toLowerCase())) throw new Error('unsupported document extension')
  const realRoot = await realpath(root)
  const target = resolve(realRoot, rel)
  if (!pathWithin(realRoot, target)) throw new Error('document is outside the workspace')
  await mkdir(dirname(target), { recursive: true })
  // Re-check after creating parents: an existing symlinked directory must not lead out.
  const realParent = await realpath(dirname(target))
  if (!pathWithin(realRoot, realParent)) throw new Error('document is outside the workspace')
  const final = join(realParent, basename(target))
  try { await lstat(final); throw new Error('a document with that name already exists') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(final, content, { encoding: 'utf8', flag: 'wx' })
  return final
}

/** Replace a text document only if it still hashes to what the edit was written against. */
export async function replaceWorkFile(root: string, relativePath: string, edits: readonly WorkbenchEdit[], baseSha256: string): Promise<string> {
  const path = await resolveWorkFile(root, relativePath)
  if (!WORK_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('only text documents can be edited')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let data: Buffer
  try {
    const info = await handle.stat()
    if (info.size > MAX_EDITABLE_BYTES) throw new Error('document is too large to edit')
    data = Buffer.alloc(info.size)
    await handle.read(data, 0, data.length, 0)
  } finally { await handle.close() }
  if (sha256(data) !== baseSha256) throw new Error('The document changed after this edit was proposed. Ask the assistant to propose it again.')
  const next = applyWorkEdits(data.toString('utf8'), edits)
  const temp = path + '.kun-edit'
  await writeFile(temp, next, { encoding: 'utf8', flag: 'w' })
  await rename(temp, path)
  return path
}

export type WorkDocumentEntry = { path: string; relativePath: string; bytes: number; updatedAt: string }

/** Depth-limited walk of a Work workspace; bounded so a huge tree cannot stall a tool call. */
export async function listWorkDocuments(root: string, options: { maxEntries?: number; maxDepth?: number } = {}): Promise<WorkDocumentEntry[]> {
  const maxEntries = options.maxEntries ?? 400, maxDepth = options.maxDepth ?? 4
  const realRoot = await realpath(root)
  const found: WorkDocumentEntry[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (found.length >= maxEntries) return
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= maxEntries) return
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIPPED_DIRECTORIES.has(entry.name)) await walk(full, depth + 1)
      } else if (entry.isFile() && WORK_DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        try {
          const info = await stat(full)
          found.push({ path: full, relativePath: full.slice(realRoot.length + 1).split(sep).join('/'), bytes: info.size,
            updatedAt: info.mtime.toISOString() })
        } catch { /* vanished while listing */ }
      }
    }
  }
  await walk(realRoot, 0)
  return found
}

/** File-name matches first, then a bounded scan of small text documents for the phrase. */
export async function searchWorkDocuments(root: string, query: string, limit: number): Promise<Array<WorkDocumentEntry & { match: 'name' | 'content'; snippet?: string }>> {
  const needle = query.toLowerCase()
  const docs = await listWorkDocuments(root)
  const hits: Array<WorkDocumentEntry & { match: 'name' | 'content'; snippet?: string }> = []
  for (const doc of docs) {
    if (hits.length >= limit) break
    if (doc.relativePath.toLowerCase().includes(needle)) hits.push({ ...doc, match: 'name' })
  }
  const deadline = Date.now() + 3_000
  for (const doc of docs) {
    if (hits.length >= limit || Date.now() >= deadline) break
    if (hits.some((hit) => hit.path === doc.path) || !WORK_TEXT_EXTENSIONS.has(extname(doc.path).toLowerCase()) || doc.bytes > 512 * 1024) continue
    try {
      const handle = await open(doc.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let text: string
      try { const buffer = Buffer.alloc(doc.bytes); await handle.read(buffer, 0, buffer.length, 0); text = buffer.toString('utf8') } finally { await handle.close() }
      const at = text.toLowerCase().indexOf(needle)
      if (at >= 0) hits.push({ ...doc, match: 'content', snippet: text.slice(Math.max(0, at - 60), at + needle.length + 100).replace(/\s+/g, ' ') })
    } catch { /* unreadable: skip */ }
  }
  return hits
}
