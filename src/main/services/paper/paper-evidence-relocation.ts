import { rename } from 'node:fs/promises'
import { relative } from 'node:path'
import { canonicalPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { mutatePaperEvidenceWorkspace, PaperEvidenceError, readPaperEvidenceWorkspace } from './paper-evidence-store'

/** Move the unit and its evidence pointers under the same serialization boundary. */
export async function renamePaperUnitWithEvidence(rootAbs: string, source: string, target: string): Promise<void> {
  const root = await canonicalPath(rootAbs)
  const from = await resolveTargetPathWithinWorkspace(source, root)
  const to = await resolveTargetPathWithinWorkspace(target, root)
  const previousUnitDir = relative(root, from).replaceAll('\\', '/')
  const unitDir = relative(root, to).replaceAll('\\', '/')
  const state = await readPaperEvidenceWorkspace(root)
  let moved = false
  await mutatePaperEvidenceWorkspace(root, state.revision, async (current) => {
    await rename(from, to)
    moved = true
    for (const item of current.evidence) if (item.unitDir === previousUnitDir) item.unitDir = unitDir
    for (const matrix of current.matrices) {
      for (const row of matrix.rows) if (row.unitDir === previousUnitDir) row.unitDir = unitDir
      for (const cell of matrix.cells) if (cell.unitDir === previousUnitDir) cell.unitDir = unitDir
    }
  }, {
    skipUnchanged: true,
    rollback: async () => {
      if (!moved) return
      try { await rename(to, from) } catch {
        throw new PaperEvidenceError('move-rollback-failed', 'The paper moved but its evidence index could not be saved or restored. Keep both folders unchanged and repair the evidence index before continuing.')
      }
    }
  })
}
