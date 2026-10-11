import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'

/** Best-effort host evidence, never an extra read capability. Outside the
 * existing readable workspace or on unverifiable paths, leave it unknown.
 * The caller's write behavior and approval/open flags remain unchanged. */
export async function fileWriteChanged(path: string, content: string, context: ToolHostContext): Promise<boolean | undefined> {
  const readContext = { ...context, approvedExternalWriteTargets: undefined, allowHostReads: false }
  try {
    await resolveWorkspacePath(path, readContext, { enforceWorkspaceBoundary: true })
  } catch { return undefined }
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.ino === 0n) return undefined
    // Fence parent/symlink changes between path authorization and open.
    await resolveWorkspacePath(path, readContext, { enforceWorkspaceBoundary: true })
    const current = await stat(path, { bigint: true })
    if (current.dev !== before.dev || current.ino !== before.ino) return undefined
    const desired = Buffer.from(content, 'utf8')
    if (before.size !== BigInt(desired.length)) return true
    const buffer = Buffer.alloc(Math.min(64 * 1024, desired.length))
    let offset = 0
    while (offset < desired.length) {
      const length = Math.min(buffer.length, desired.length - offset)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (!bytesRead) return undefined
      if (!buffer.subarray(0, bytesRead).equals(desired.subarray(offset, offset + bytesRead))) return true
      offset += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    return after.size === before.size && after.mtimeNs === before.mtimeNs ? false : undefined
  } catch (error) {
    // A missing in-scope destination is creation, not a read of another file.
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? true : undefined
  } finally { await handle?.close().catch(() => undefined) }
}
