import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'

export function localSharePath(dataDir: string, threadId: string): string {
  return join(dataDir, 'tui', 'shares', `${threadId}.md`)
}

export async function writeLocalShareSnapshot(dataDir: string, threadId: string, markdown: string): Promise<string> {
  const path = localSharePath(dataDir, threadId)
  await withRuntimeDataDirAncillaryWriter(dataDir, async () => {
    await mkdir(join(dataDir, 'tui', 'shares'), { recursive: true, mode: 0o700 })
    await writeFile(path, markdown, { encoding: 'utf8', mode: 0o600 })
  })
  return path
}

export async function removeLocalShareSnapshot(dataDir: string, threadId: string): Promise<void> {
  await withRuntimeDataDirAncillaryWriter(dataDir, async () => {
    await unlink(localSharePath(dataDir, threadId))
  })
}
