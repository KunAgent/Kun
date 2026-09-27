import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { applyPosixMode } from '../security/posix-permissions.js'

/**
 * Shared helpers for the per-team ADE JSON files. Reads are schema-validated;
 * a corrupt file is logged and treated as absent so a damaged control-plane
 * file can never wedge the manager thread itself (P1-10 acceptance).
 */
export async function readAdeJson<S extends z.ZodType, F = null>(
  path: string,
  schema: S,
  fallback: () => z.infer<S> | F
): Promise<z.infer<S> | F> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return fallback()
    console.warn(`[kun] ade store read failed path=${path}:`, error)
    return fallback()
  }
  try {
    return schema.parse(JSON.parse(contents) as unknown)
  } catch (error) {
    console.warn(`[kun] ade store discarded corrupt file path=${path}:`, error)
    return fallback()
  }
}

export async function writeAdeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await applyPosixMode(dirname(path), 0o700)
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    durable: true,
    allowDirectWriteFallback: false
  })
}

/** Serialize mutations for one manager's team data across Runtime processes. */
export function withAdeTeamMutex<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
  return withManagerDataMutex(`ade-team:${teamId}`, () => operation())
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
