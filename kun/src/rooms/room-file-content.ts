import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { RoomRepository } from '../contracts/rooms.js'

function inside(root: string, path: string): boolean {
  const pathWithin = relative(root, path)
  return pathWithin !== '..' && !pathWithin.startsWith('../') && !isAbsolute(pathWithin)
}
export async function readRoomRepositoryFile(repository: Pick<RoomRepository, 'canonicalRoot'>, relativePath: string, maxBytes: number) {
  const path = await realpath(resolve(repository.canonicalRoot, relativePath))
  if (!inside(repository.canonicalRoot, path)) throw new Error('file_unauthorized')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    const observedPath = await realpath(resolve(repository.canonicalRoot, relativePath))
    const observed = await stat(observedPath)
    if (!inside(repository.canonicalRoot, observedPath) || info.dev !== observed.dev || info.ino !== observed.ino || !info.isFile()) {
      throw new Error('file_changed')
    }
    const bytes = Buffer.alloc(Math.min(info.size, maxBytes))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return { data: bytes.subarray(0, bytesRead), size: info.size }
  } finally { await handle.close() }
}
