/**
 * ACP fs/read_text_file + fs/write_text_file (docs/ade/03 §8.1).
 * Every path is resolved through symlinks and must land inside a declared
 * root — reads use the thread's read roots (workspace + additional
 * workspaces), writes only the task workspace. Writes pass the Kun approval
 * pipeline and ensure a workspace checkpoint exists before mutating.
 */
import { open, readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  isPathInsideOrEqual,
  resolvePathThroughSymlinks
} from '../../adapters/tool/workspace-path.js'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import { ACP_RPC_ERROR, AcpError } from './acp-schema.js'

/** Returned content is capped; the read itself caps at the same bound. */
export const ACP_FS_MAX_CONTENT_BYTES = 2 * 1024 * 1024

export type AcpFsRequest = {
  sessionId: string
  path: string
  line?: number | null
  limit?: number | null
}

export type AcpWriteRequest = AcpFsRequest & { content: string }

/**
 * Resolve `rawPath` to a real filesystem path that lives inside one of
 * `roots` (already physical). Relative paths resolve against the first root.
 * Throws `policyDenied` on any escape — including through symlinks.
 */
export async function resolveInside(
  roots: readonly string[],
  rawPath: string
): Promise<string> {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw new AcpError('harness_protocol_error', 'path is required', {
      rpcCode: ACP_RPC_ERROR.invalidParams
    })
  }
  const lexical = isAbsolute(trimmed)
    ? resolve(trimmed)
    : roots.length
      ? resolve(roots[0], trimmed)
      : resolve(trimmed)
  // resolvePathThroughSymlinks follows every existing link while preserving
  // a nonexistent tail, so a write to <symlink>/new.txt lands at the real
  // directory — and is rejected when that directory is outside the roots.
  const physical = await resolvePathThroughSymlinks(lexical)
  for (const root of roots) {
    if (isPathInsideOrEqual(root, physical)) return physical
  }
  throw new AcpError(
    'policy_denied',
    `path escapes the task workspace: ${rawPath.slice(0, 256)}`,
    { rpcCode: ACP_RPC_ERROR.policyDenied }
  )
}

export async function readTextFile(
  abs: string,
  options: { line?: number | null; limit?: number | null } = {}
): Promise<{ content: string }> {
  const handle = await open(abs, 'r')
  try {
    const buffer = Buffer.alloc(ACP_FS_MAX_CONTENT_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    const truncated = bytesRead > ACP_FS_MAX_CONTENT_BYTES
    if (truncated) text = text.slice(0, ACP_FS_MAX_CONTENT_BYTES)
    const line = options.line ?? undefined
    const limit = options.limit ?? undefined
    if (line !== undefined || limit !== undefined) {
      const lines = text.split('\n')
      const start = Math.max(0, (line ?? 1) - 1)
      const end = limit !== undefined ? start + limit : lines.length
      text = lines.slice(start, end).join('\n')
    }
    if (truncated) {
      text += '\n[truncated: file exceeds the 2 MiB read limit]'
    }
    return { content: text }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      throw new AcpError(
        'policy_denied',
        `cannot read ${code === 'EISDIR' ? 'a directory' : 'a missing path'}`,
        { rpcCode: ACP_RPC_ERROR.invalidParams }
      )
    }
    throw error
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** Read the pre-write contents for the recorded diff (null when absent). */
export async function readIfExists(abs: string): Promise<string | null> {
  try {
    const buffer = await readFile(abs)
    if (buffer.length > ACP_FS_MAX_CONTENT_BYTES) {
      return buffer.subarray(0, ACP_FS_MAX_CONTENT_BYTES).toString('utf8')
    }
    return buffer.toString('utf8')
  } catch {
    return null
  }
}

export async function writeTextFile(abs: string, content: string): Promise<void> {
  await atomicWriteFile(abs, content)
}
