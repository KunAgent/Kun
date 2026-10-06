import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paperEvidenceWorkspaceSchema, type PaperEvidenceWorkspace } from '../../../shared/paper/paper-evidence-types'
import { assertPaperMatrixIntegrity, PaperMatrixValidationError } from '../../../shared/paper/paper-matrix'
import { atomicWriteFile } from '../../atomic-json-file'
import { canonicalPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'

export class PaperEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PaperEvidenceError'
  }
}

const pending = new Map<string, Promise<unknown>>()
const empty = (): PaperEvidenceWorkspace => ({ version: 1, revision: 0, evidence: [], matrices: [] })

async function storePath(root: string): Promise<string> {
  return resolveTargetPathWithinWorkspace(join('.kun', 'paper-evidence', 'workspace.json'), root)
}

/** Missing is empty; malformed or unreadable is an error and must never be overwritten. */
export async function readPaperEvidenceWorkspace(root: string): Promise<PaperEvidenceWorkspace> {
  const path = await storePath(root)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
    throw error
  }
  try {
    const result = paperEvidenceWorkspaceSchema.parse(JSON.parse(raw))
    if (new Set(result.evidence.map((item) => item.id)).size !== result.evidence.length ||
        new Set(result.matrices.map((item) => item.id)).size !== result.matrices.length) {
      throw new Error('Duplicate record IDs.')
    }
    for (const matrix of result.matrices) assertPaperMatrixIntegrity(matrix, result.evidence)
    return result
  } catch {
    throw new PaperEvidenceError('corrupt-store', 'The paper evidence store is malformed. Restore or repair it before saving; it has not been overwritten.')
  }
}

/** Process-wide serialization plus client revision checks prevent concurrent lost updates. */
export async function mutatePaperEvidenceWorkspace(
  root: string,
  expectedRevision: number,
  mutate: (state: PaperEvidenceWorkspace) => Promise<void> | void,
  options: { rollback?: () => Promise<void>; skipUnchanged?: boolean } = {}
): Promise<PaperEvidenceWorkspace> {
  const key = await canonicalPath(root)
  const previous = pending.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const current = await readPaperEvidenceWorkspace(key)
    if (current.revision !== expectedRevision) {
      throw new PaperEvidenceError('revision-conflict', 'Paper evidence changed in another view. Reload before saving your edit.')
    }
    const original = JSON.stringify(current)
    try {
      await mutate(current)
      if (options.skipUnchanged && JSON.stringify(current) === original) {
        if (JSON.stringify(await readPaperEvidenceWorkspace(key)) !== original) {
          throw new PaperEvidenceError('revision-conflict', 'Paper evidence changed during this operation. Reload before saving.')
        }
        return current
      }
      current.revision += 1
      const checked = paperEvidenceWorkspaceSchema.parse(current)
      try {
        for (const matrix of checked.matrices) assertPaperMatrixIntegrity(matrix, checked.evidence)
      } catch (error) {
        if (error instanceof PaperMatrixValidationError) throw new PaperEvidenceError(error.code, error.message)
        throw error
      }
      // Also catch out-of-process edits made while an async capture was running.
      if (JSON.stringify(await readPaperEvidenceWorkspace(key)) !== original) {
        throw new PaperEvidenceError('revision-conflict', 'Paper evidence changed during this operation. Reload before saving.')
      }
      await atomicWriteFile(await storePath(key), `${JSON.stringify(checked, null, 2)}\n`)
      return checked
    } catch (error) {
      await options.rollback?.()
      throw error
    }
  })
  pending.set(key, operation)
  try {
    return await operation
  } finally {
    if (pending.get(key) === operation) pending.delete(key)
  }
}
