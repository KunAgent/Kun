import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import { z } from 'zod'
import {
  PAPER_MATRIX_AXES,
  paperMatrixAxisSchema,
  paperMatrixPatchSchema,
  type PaperMatricesResult,
  type PaperMatrixAxis,
  type PaperMatrixPatch
} from '../../../shared/paper/paper-evidence-types'
import {
  assertPaperMatrixIntegrity,
  createPaperComparisonMatrix,
  PaperMatrixValidationError,
  updatePaperComparisonMatrix,
  type PaperMatrixRow
} from '../../../shared/paper/paper-matrix'
import { canonicalPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { readPaperUnitMetaV2 } from './paper-library-service'
import { readPaperIdentity } from './paper-evidence-version'
import {
  mutatePaperEvidenceWorkspace,
  PaperEvidenceError,
  readPaperEvidenceWorkspace
} from './paper-evidence-store'

const revision = z.number().int().nonnegative()
const unitDirs = z.array(z.string().trim().min(1).max(4096)).max(100)
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  unitDirs,
  axes: z.array(paperMatrixAxisSchema).min(1).max(PAPER_MATRIX_AXES.length),
  expectedRevision: revision
}).strict()
const updateSchema = z.object({
  matrixId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  patch: paperMatrixPatchSchema,
  expectedRevision: revision
}).strict()

async function resolveRows(root: string, paths: readonly string[]): Promise<PaperMatrixRow[]> {
  const canonicalRoot = await canonicalPath(root)
  const seen = new Set<string>()
  const rows: PaperMatrixRow[] = []
  for (const path of paths) {
    let absolute: string
    try {
      absolute = await resolveTargetPathWithinWorkspace(path, canonicalRoot)
      // Check metadata itself, not only its parent, before following a symlink.
      await resolveTargetPathWithinWorkspace(`${absolute}/paper.json`, canonicalRoot)
    } catch {
      throw new PaperEvidenceError('invalid-unit', 'Paper path must stay within the workspace.')
    }
    const unitDir = relative(canonicalRoot, absolute).replaceAll('\\', '/') || '.'
    if (seen.has(unitDir)) continue
    if (!await readPaperUnitMetaV2(absolute)) {
      throw new PaperEvidenceError('invalid-unit', 'Comparison rows must reference existing paper units.')
    }
    const { canonicalId, citeKey, title } = await readPaperIdentity(absolute)
    rows.push({ unitDir, canonicalId, citeKey, title })
    seen.add(unitDir)
  }
  return rows
}

function rethrowMatrixError(error: unknown): never {
  if (error instanceof PaperMatrixValidationError) {
    throw new PaperEvidenceError(error.code, error.message)
  }
  throw error
}

export async function readPaperMatrices(workspaceRootAbs: string): Promise<PaperMatricesResult> {
  const state = await readPaperEvidenceWorkspace(workspaceRootAbs)
  try {
    for (const matrix of state.matrices) assertPaperMatrixIntegrity(matrix, state.evidence)
  } catch (error) {
    rethrowMatrixError(error)
  }
  return { ok: true, revision: state.revision, matrices: state.matrices }
}

export async function createPaperMatrix(workspaceRootAbs: string, input: {
  title: string
  unitDirs: string[]
  axes: PaperMatrixAxis[]
  expectedRevision: number
}): Promise<PaperMatricesResult> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) throw new PaperEvidenceError('invalid-input', 'Invalid comparison matrix request.')
  try {
    const state = await mutatePaperEvidenceWorkspace(workspaceRootAbs, parsed.data.expectedRevision, async (state) => {
      if (state.matrices.length >= 500) {
        throw new PaperEvidenceError('limit-exceeded', 'This workspace already contains 500 comparison matrices.')
      }
      const rows = await resolveRows(workspaceRootAbs, parsed.data.unitDirs)
      state.matrices.push(createPaperComparisonMatrix({
        id: randomUUID(),
        title: parsed.data.title,
        rows,
        axes: parsed.data.axes,
        now: new Date().toISOString()
      }))
    })
    return { ok: true, revision: state.revision, matrices: state.matrices }
  } catch (error) {
    rethrowMatrixError(error)
  }
}

export async function updatePaperMatrix(workspaceRootAbs: string, input: {
  matrixId: string
  patch: PaperMatrixPatch
  expectedRevision: number
}): Promise<PaperMatricesResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) throw new PaperEvidenceError('invalid-input', 'Invalid comparison matrix update.')
  try {
    const state = await mutatePaperEvidenceWorkspace(workspaceRootAbs, parsed.data.expectedRevision, async (state) => {
      const index = state.matrices.findIndex((matrix) => matrix.id === parsed.data.matrixId)
      if (index < 0) throw new PaperEvidenceError('not-found', 'Comparison matrix was not found.')
      const { addUnitDirs = [], ...patch } = parsed.data.patch
      const addRows = await resolveRows(workspaceRootAbs, addUnitDirs)
      state.matrices[index] = updatePaperComparisonMatrix(
        state.matrices[index], { ...patch, addRows }, state.evidence, new Date().toISOString()
      )
    })
    return { ok: true, revision: state.revision, matrices: state.matrices }
  } catch (error) {
    rethrowMatrixError(error)
  }
}
