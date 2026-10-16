import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, basename } from 'node:path'
import type { Stats } from 'node:fs'
export const FILE_MAX_BYTES = 25 * 1024 * 1024
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}
export function fileRevision(info: Stats): string {
  return 'file-v1:' + createHash('sha256').update(JSON.stringify([
    info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.mode
  ])).digest('hex')
}
export function rootRevision(info: Stats): string { return `${info.dev}:${info.ino}` }
/** Open the authorized inode, then verify the path still resolves to that inode. */
export async function checkedProjectRead(root: string, path: string, revision: string, offset = 0, count = FILE_MAX_BYTES, permitted?: (path: string) => Promise<boolean>) {
  const observedPath = await realpath(path)
  if (!inside(root, observedPath) || permitted && !await permitted(observedPath)) throw new Error('FILE_NOT_ALLOWED')
  const handle = await open(observedPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat(), observed = await stat(await realpath(path))
    if (!info.isFile() || info.dev !== observed.dev || info.ino !== observed.ino ||
      fileRevision(info) !== revision || info.size > FILE_MAX_BYTES || !inside(root, await realpath(path)))
      throw new Error('FILE_NOT_ALLOWED')
    const data = Buffer.alloc(Math.min(Math.max(0, info.size - offset), count))
    let position = 0
    while (position < data.length) {
      const { bytesRead } = await handle.read(data, position, data.length - position, offset + position)
      if (!bytesRead) break
      position += bytesRead
    }
    if (position !== data.length || fileRevision(await handle.stat()) !== revision ||
      fileRevision(await stat(await realpath(path))) !== revision || permitted && !await permitted(await realpath(path))) throw new Error('FILE_CHANGED')
    return { data, size: info.size, name: basename(resolve(path)) }
  } finally { await handle.close() }
}
