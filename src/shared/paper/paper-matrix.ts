import {
  paperComparisonMatrixSchema,
  paperMatrixPatchSchema,
  paperMatrixRowSchema,
  type PaperComparisonMatrix,
  type PaperEvidence,
  type PaperMatrixAxis,
  type PaperMatrixCell,
  type PaperMatrixPatch
} from './paper-evidence-types'

export type PaperMatrixRow = PaperComparisonMatrix['rows'][number]
export type PaperMatrixEvidenceSource = Pick<PaperEvidence, 'id' | 'unitDir'>
export type PaperMatrixChanges = Omit<PaperMatrixPatch, 'addUnitDirs'> & {
  addRows?: PaperMatrixRow[]
}

export class PaperMatrixValidationError extends Error {
  readonly code = 'invalid-matrix'

  constructor(message: string) {
    super(message)
    this.name = 'PaperMatrixValidationError'
  }
}

function invalid(message: string): never {
  throw new PaperMatrixValidationError(message)
}

function cellKey(unitDir: string, axis: PaperMatrixAxis): string {
  return JSON.stringify([unitDir, axis])
}

function uniqueRows(rows: readonly PaperMatrixRow[]): PaperMatrixRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.unitDir)) return false
    seen.add(row.unitDir)
    return true
  }).map((row) => ({ ...row }))
}

/** Unknown means no claim. In particular, missing limitations are not "none". */
export function emptyPaperMatrixCell(
  unitDir: string,
  axis: PaperMatrixAxis,
  now: string
): PaperMatrixCell {
  return {
    unitDir,
    axis,
    value: '',
    status: 'not-reported',
    evidenceIds: [],
    comparability: 'unknown',
    comparabilityReason: '',
    updatedAt: now
  }
}

/** Structural schemas alone cannot verify row/axis membership or provenance. */
export function assertPaperMatrixIntegrity(
  matrix: PaperComparisonMatrix,
  evidence: readonly PaperMatrixEvidenceSource[]
): void {
  const parsed = paperComparisonMatrixSchema.safeParse(matrix)
  if (!parsed.success) invalid('Invalid comparison matrix structure or size.')
  const rows = new Set(matrix.rows.map((row) => row.unitDir))
  const axes = new Set(matrix.axes)
  if (rows.size !== matrix.rows.length || axes.size !== matrix.axes.length) {
    invalid('Comparison matrix rows and axes must be unique.')
  }
  const sources = new Map(evidence.map((item) => [item.id, item.unitDir]))
  if (sources.size !== evidence.length) invalid('Evidence source IDs must be unique.')
  const seen = new Set<string>()
  for (const cell of matrix.cells) {
    if (!rows.has(cell.unitDir) || !axes.has(cell.axis)) {
      invalid('Comparison cell references an unknown row or axis.')
    }
    const key = cellKey(cell.unitDir, cell.axis)
    if (seen.has(key)) invalid('Comparison matrix contains duplicate cells.')
    seen.add(key)
    const populated = cell.value.trim().length > 0
    if (populated !== (cell.status === 'reported')) {
      invalid('Reported cells need a value; not-reported cells must stay blank.')
    }
    if (cell.comparability !== 'unknown' && !cell.comparabilityReason.trim()) {
      invalid('Comparability judgments need an explicit reason.')
    }
    if ((populated || cell.comparability !== 'unknown' || cell.comparabilityReason.trim()) &&
      cell.evidenceIds.length === 0) {
      invalid('Populated cells and comparability judgments need source evidence.')
    }
    for (const evidenceId of cell.evidenceIds) {
      if (!sources.has(evidenceId)) invalid('Comparison cell source evidence does not exist.')
      if (sources.get(evidenceId) !== cell.unitDir) {
        invalid('Comparison cell source evidence belongs to a different paper.')
      }
    }
  }
  if (matrix.cells.length !== rows.size * axes.size) {
    invalid('Comparison matrix must include an explicit cell for every row and axis.')
  }
}

export function createPaperComparisonMatrix(input: {
  id: string
  title: string
  rows: PaperMatrixRow[]
  axes: PaperMatrixAxis[]
  now: string
}): PaperComparisonMatrix {
  for (const row of input.rows) {
    if (!paperMatrixRowSchema.safeParse(row).success) invalid('Invalid comparison paper row.')
  }
  const rows = uniqueRows(input.rows)
  const axes = [...new Set(input.axes)]
  const matrix: PaperComparisonMatrix = {
    id: input.id,
    title: input.title.trim(),
    rows,
    axes,
    cells: rows.flatMap((row) => axes.map((axis) => emptyPaperMatrixCell(row.unitDir, axis, input.now))),
    createdAt: input.now,
    updatedAt: input.now
  }
  assertPaperMatrixIntegrity(matrix, [])
  return matrix
}

/** Incremental additions never replace a user's existing cell edits. */
export function updatePaperComparisonMatrix(
  matrix: PaperComparisonMatrix,
  changes: PaperMatrixChanges,
  evidence: readonly PaperMatrixEvidenceSource[],
  now: string
): PaperComparisonMatrix {
  assertPaperMatrixIntegrity(matrix, evidence)
  const { addRows = [], ...patchInput } = changes
  const parsed = paperMatrixPatchSchema.safeParse(patchInput)
  if (!parsed.success) invalid('Invalid comparison matrix patch.')
  for (const row of addRows) {
    if (!paperMatrixRowSchema.safeParse(row).success) invalid('Invalid comparison paper row.')
  }
  const patch = parsed.data
  const rows = uniqueRows([...matrix.rows, ...addRows])
  const axes = [...new Set([...matrix.axes, ...(patch.addAxes ?? [])])]
  const cells = new Map(matrix.cells.map((cell) => [cellKey(cell.unitDir, cell.axis), {
    ...cell,
    evidenceIds: [...cell.evidenceIds]
  }]))
  for (const row of rows) {
    for (const axis of axes) {
      const key = cellKey(row.unitDir, axis)
      if (!cells.has(key)) cells.set(key, emptyPaperMatrixCell(row.unitDir, axis, now))
    }
  }
  const editedCells = new Set<string>()
  for (const cell of patch.cells ?? []) {
    const key = cellKey(cell.unitDir, cell.axis)
    if (!cells.has(key)) invalid('Comparison cell references an unknown row or axis.')
    if (editedCells.has(key)) invalid('Comparison patch contains duplicate cells.')
    editedCells.add(key)
    cells.set(key, { ...cell, evidenceIds: [...new Set(cell.evidenceIds)], updatedAt: now })
  }
  const updated: PaperComparisonMatrix = {
    ...matrix,
    title: patch.title ?? matrix.title,
    rows,
    axes,
    cells: rows.flatMap((row) => axes.map((axis) => cells.get(cellKey(row.unitDir, axis))!)),
    updatedAt: now
  }
  assertPaperMatrixIntegrity(updated, evidence)
  return updated
}
