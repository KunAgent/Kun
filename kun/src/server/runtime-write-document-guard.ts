import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { WriteTurnContext } from '../contracts/write-turn-context.js'

export type WriteDocumentGuard = (context: WriteTurnContext) => Promise<string | null>

/**
 * Resolve a durable Write document reference to an absolute path strictly
 * inside `workspaceRoot`. Returns null when the path escapes the workspace
 * (e.g. `../` traversal) or the workspace root is not absolute. An absolute
 * `documentPath` is accepted when it still resolves inside the root.
 */
export function resolveWriteDocumentPath(workspaceRoot: string, documentPath: string): string | null {
  if (!isAbsolute(workspaceRoot)) return null
  const root = resolve(workspaceRoot)
  const candidate = isAbsolute(documentPath) ? resolve(documentPath) : resolve(root, documentPath)
  const rel = relative(root, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return candidate
}

/**
 * Node fs-backed guard for `TurnServiceDeps.writeDocumentGuard`. Whiteboard-only
 * sends (null documentPath) pass through; every document-bearing send must still
 * exist on disk and, when a baseline fingerprint was captured, match it.
 */
export function createWriteDocumentGuard(): WriteDocumentGuard {
  return async (context) => {
    if (!context.documentPath) return null
    const absolutePath = resolveWriteDocumentPath(context.workspaceRoot, context.documentPath)
    if (!absolutePath) return 'write document path escapes the workspace'
    let bytes: Buffer
    try {
      bytes = await readFile(absolutePath)
    } catch {
      return `write document not found: ${context.documentPath}`
    }
    if (context.expectedSha256) {
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== context.expectedSha256) {
        return 'write document changed after the request was queued'
      }
    }
    return null
  }
}
