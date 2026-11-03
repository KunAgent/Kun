import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Entry, ZipFile } from 'yauzl'

export const MAX_SKILL_ARCHIVE_ENTRIES = 2000
export const MAX_SKILL_UNPACKED_BYTES = 100 * 1024 * 1024

const SYMLINK_MODE = 0o120000
const FILE_TYPE_MASK = 0o170000

type ListedEntry = { entry: Entry; path: string; isDirectory: boolean }

async function openZip(buffer: Buffer): Promise<ZipFile> {
  const yauzlModule = await import('yauzl')
  const yauzl = yauzlModule.default ?? yauzlModule
  return new Promise<ZipFile>((resolveZip, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('Could not open the skill archive.'))
      else resolveZip(zip)
    })
  })
}

/**
 * Normalizes a zip entry name to a clean relative POSIX path, or `null` when
 * it is unusable (absolute, drive-qualified or climbing out via `..`) or is
 * archive junk Finder adds (`__MACOSX/`, `.DS_Store`, `._*` resource forks).
 */
export function normalizeArchiveEntryPath(name: string): string | null {
  const unified = name.replace(/\\/g, '/')
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) return null
  const segments = unified.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.includes('..')) return null
  const last = segments[segments.length - 1] as string
  if (segments[0] === '__MACOSX' || last === '.DS_Store' || last.startsWith('._')) return null
  return segments.join('/')
}

async function listEntries(zip: ZipFile): Promise<ListedEntry[]> {
  return new Promise<ListedEntry[]>((resolveList, reject) => {
    const entries: ListedEntry[] = []
    zip.on('error', reject)
    zip.on('end', () => resolveList(entries))
    zip.on('entry', (entry: Entry) => {
      if (entries.length >= MAX_SKILL_ARCHIVE_ENTRIES) {
        reject(new Error('The skill archive has too many files.'))
        zip.close()
        return
      }
      const raw = entry.fileName
      const path = normalizeArchiveEntryPath(raw)
      if (path === null) {
        // Junk entries are skipped; escaping/absolute names fail the whole archive.
        const unified = raw.replace(/\\/g, '/')
        if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified) || unified.split('/').includes('..')) {
          reject(new Error(`Unsafe path in skill archive: ${raw}`))
          zip.close()
          return
        }
      } else {
        entries.push({ entry, path, isDirectory: raw.endsWith('/') })
      }
      zip.readEntry()
    })
    zip.readEntry()
  })
}

/** The folder inside the archive that holds `SKILL.md` ('' = archive root). */
export function findSkillPrefix(paths: readonly string[]): string {
  const files = new Set(paths)
  if (files.has('SKILL.md')) return ''
  const candidates = new Set<string>()
  for (const path of files) {
    const [top, second, ...rest] = path.split('/')
    if (top && second === 'SKILL.md' && rest.length === 0) candidates.add(top)
  }
  if (candidates.size === 1) return `${[...candidates][0]}/`
  throw new Error(
    candidates.size === 0
      ? 'The archive does not contain a SKILL.md.'
      : 'The archive contains more than one skill.'
  )
}

/**
 * Unpacks the skill inside `buffer` into `destDir` (which must be new/empty).
 * Refuses path traversal, skips symlinks and bounds entry count and size.
 */
export async function extractSkillArchive(buffer: Buffer, destDir: string): Promise<{ fileCount: number }> {
  const listing = await listEntries(await openZip(buffer))
  const prefix = findSkillPrefix(listing.filter((item) => !item.isDirectory).map((item) => item.path))
  const selected = listing.filter((item) =>
    !item.isDirectory &&
    item.path.startsWith(prefix) &&
    ((item.entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK) !== SYMLINK_MODE
  )
  const declaredBytes = selected.reduce((sum, item) => sum + item.entry.uncompressedSize, 0)
  if (declaredBytes > MAX_SKILL_UNPACKED_BYTES) {
    throw new Error('The skill archive is too large once unpacked.')
  }
  const root = resolve(destDir)
  const wanted = new Map(selected.map((item) => [item.entry.fileName, item]))
  const zip = await openZip(buffer)
  await new Promise<void>((resolveAll, reject) => {
    zip.on('error', reject)
    zip.on('end', () => resolveAll())
    zip.on('entry', (entry: Entry) => {
      const item = wanted.get(entry.fileName)
      if (!item) {
        zip.readEntry()
        return
      }
      const target = resolve(join(root, item.path.slice(prefix.length)))
      if (!target.startsWith(root + sep)) {
        reject(new Error(`Unsafe path in skill archive: ${entry.fileName}`))
        zip.close()
        return
      }
      const executable = ((entry.externalFileAttributes >>> 16) & 0o111) !== 0
      mkdir(dirname(target), { recursive: true })
        .then(() => new Promise<void>((resolveEntry, rejectEntry) => {
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              rejectEntry(error ?? new Error(`Could not read ${entry.fileName}`))
              return
            }
            pipeline(stream, createWriteStream(target, { mode: executable ? 0o755 : 0o644 }))
              .then(resolveEntry, rejectEntry)
          })
        }))
        .then(() => zip.readEntry())
        .catch((error) => {
          reject(error)
          zip.close()
        })
    })
    zip.readEntry()
  })
  return { fileCount: selected.length }
}
