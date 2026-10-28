import { readFile } from 'node:fs/promises'
import {
  assertMcpLockHeld,
  sharedMcpLockPath,
  withSharedMcpLock
} from '../../../kun/src/server/runtime-mcp-lock.js'
import { atomicWriteFile } from '../atomic-json-file'

/** The user-owned MCP file changed after the caller read it. */
export class McpConfigStaleWriteError extends Error {
  constructor(readonly configPath: string) {
    super(
      `MCP configuration ${configPath} changed on disk since it was loaded; reload it before saving`
    )
    this.name = 'McpConfigStaleWriteError'
  }
}

/**
 * Write the user-owned MCP file (plugin marketplace or raw editor) under the
 * same cross-process lock the Runtime uses for its shared-file writes.
 *
 * When the caller supplies the text it loaded, the write is rejected if the
 * file changed in the meantime, so a stale snapshot cannot silently overwrite a
 * Runtime disable. Callers that intentionally rewrite the whole document (the
 * raw editor) omit the base and remain allowed; they are still serialized.
 */
export async function writeKunMcpConfigFile(options: {
  path: string
  content: string
  baseContent?: string
  onWritten?: (path: string, content: string) => Promise<void> | void
}): Promise<void> {
  await withSharedMcpLock(options.path, async (owner) => {
    if (options.baseContent !== undefined) {
      const current = await readMcpConfigText(options.path)
      if ((current ?? '') !== options.baseContent) {
        throw new McpConfigStaleWriteError(options.path)
      }
    }
    await assertMcpLockHeld(sharedMcpLockPath(options.path), owner)
    await atomicWriteFile(options.path, options.content)
  })
  // Runs outside the shared lock: GUI synchronization takes the data-directory
  // lock and then the shared lock again, so holding it here would deadlock.
  await options.onWritten?.(options.path, options.content)
}

async function readMcpConfigText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw error
  }
}
