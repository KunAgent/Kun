import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { NOTEBOOK_IMPORT_MAX_BYTES, type NotebookPullSave } from '../../shared/colab/colab-notebook-types'

export function isValidIpynbBytes(bytes: Buffer): boolean {
  if (bytes.byteLength > NOTEBOOK_IMPORT_MAX_BYTES) return false
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return Boolean(parsed && typeof parsed === 'object' && 'cells' in parsed && Array.isArray(parsed.cells))
  } catch {
    return false
  }
}

export async function resolveNotebookImportRoot(root: string): Promise<string> {
  const path = root.trim()
  if (!isAbsolute(path)) throw new Error('Select a project workspace first.')
  return realpath(path)
}

/** Exclusive creation protects edits in another window (including symlink destinations). */
export async function writeNonCollidingNotebook(
  workspaceRoot: string,
  rawName: string,
  bytes: Buffer,
  source?: 'Colab' | 'Jupyter'
): Promise<Pick<NotebookPullSave, 'relativePath' | 'disposition'>> {
  if (!isValidIpynbBytes(bytes)) throw new Error('Selected file is not a valid .ipynb within the size limit.')
  const root = await resolveNotebookImportRoot(workspaceRoot)
  const stem = (basename(rawName).replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').replace(/\.ipynb$/i, '').trim()
    .replace(/^\.+/, '').replace(/[. ]+$/, '') || 'Imported').slice(0, 56)
  for (let index = 0; index < 100; index += 1) {
    const tag = source ? `${source}${index > 1 ? ` ${index}` : ''}` : String(index + 1)
    const relativePath = `${stem}${index === 0 ? '' : ` (${tag})`}.ipynb`
    const dest = join(root, relativePath)
    const create = await open(dest, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST' || error.code === 'EISDIR') return null
      throw error
    })
    if (create) {
      try {
        await create.writeFile(bytes)
      } finally {
        await create.close()
      }
      return { relativePath, disposition: index === 0 ? 'created' : 'renamed' }
    }
    // O_NOFOLLOW avoids reading a same-named symlink outside the selected project. Non-blocking
    // opens avoid hanging on named pipes. Only inspect an ordinary file of exactly the right size.
    const existing = await open(dest, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null)
    if (existing) {
      try {
        const stat = await existing.stat()
        if (stat.isFile() && stat.size === bytes.length) {
          const check = Buffer.alloc(bytes.length + 1)
          const { bytesRead } = await existing.read(check)
          if (bytesRead === bytes.length && check.subarray(0, bytesRead).equals(bytes)) {
            return { relativePath, disposition: 'reused' }
          }
        }
      } finally {
        await existing.close()
      }
    }
  }
  throw new Error('Could not find an unused notebook name in the project.')
}
