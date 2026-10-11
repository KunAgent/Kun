import { describe, expect, it } from 'vitest'
import { PAPER_MATRIX_AXES, type PaperMatrixCell } from './paper-evidence-types'
import {
  assertPaperMatrixIntegrity,
  createPaperComparisonMatrix,
  emptyPaperMatrixCell,
  PaperMatrixValidationError,
  updatePaperComparisonMatrix,
  type PaperMatrixRow
} from './paper-matrix'

const before = '2026-10-01T00:00:00.000Z'
const after = '2026-10-02T00:00:00.000Z'
const row = (unitDir: string): PaperMatrixRow => ({
  unitDir, title: unitDir, canonicalId: `doi:${unitDir}`, citeKey: unitDir.replaceAll('/', '_')
})
const sources = [{ id: 'source-a', unitDir: 'papers/a' }, { id: 'source-b', unitDir: 'papers/b' }]
function matrix() {
  return createPaperComparisonMatrix({
    id: 'matrix', title: 'Comparison', rows: [row('papers/a')], axes: ['result', 'limitations'], now: before
  })
}
function cell(patch: Partial<PaperMatrixCell> = {}): Omit<PaperMatrixCell, 'updatedAt'> {
  const { updatedAt: _, ...value } = emptyPaperMatrixCell('papers/a', 'result', before)
  return { ...value, value: 'Accuracy 91%', status: 'reported', evidenceIds: ['source-a'], ...patch }
}

describe('paper comparison matrix helpers', () => {
  it('leaves every missing result unknown without inventing negative limitations', () => {
    const result = matrix()
    expect(result.cells).toHaveLength(2)
    expect(result.cells.map(({ value, status, evidenceIds, comparability }) => ({ value, status, evidenceIds, comparability })))
      .toEqual([
        { value: '', status: 'not-reported', evidenceIds: [], comparability: 'unknown' },
        { value: '', status: 'not-reported', evidenceIds: [], comparability: 'unknown' }
      ])
  })

  it('deduplicates rows and axes without replacing the first paper identity', () => {
    const result = createPaperComparisonMatrix({
      id: 'matrix', title: ' Comparison ', now: before,
      rows: [row('papers/a'), { ...row('papers/a'), title: 'Other title' }],
      axes: ['result', 'result', 'limitations']
    })
    expect(result.rows).toEqual([row('papers/a')])
    expect(result.axes).toEqual(['result', 'limitations'])
    expect(result.cells).toHaveLength(2)
    expect(result.title).toBe('Comparison')
  })

  it('preserves edits and timestamps when adding rows and axes incrementally', () => {
    const initial = matrix()
    const edited = updatePaperComparisonMatrix(initial, { cells: [cell()] }, sources, after)
    const expanded = updatePaperComparisonMatrix(edited, {
      addRows: [row('papers/a'), row('papers/b'), row('papers/b')],
      addAxes: ['result', 'dataset', 'dataset']
    }, sources, 'later')
    expect(expanded.rows).toHaveLength(2)
    expect(expanded.axes).toEqual(['result', 'limitations', 'dataset'])
    expect(expanded.cells).toHaveLength(6)
    expect(expanded.cells[0]).toEqual(edited.cells[0])
    expect(expanded.cells[1]).toEqual(initial.cells[1])
    expect(expanded.cells.find((entry) => entry.axis === 'dataset')).toEqual(emptyPaperMatrixCell('papers/a', 'dataset', 'later'))
    expect(initial.cells[0].value).toBe('')
    expanded.cells[0].evidenceIds.push('new-source')
    expect(edited.cells[0].evidenceIds).toEqual(['source-a'])
  })

  it.each([
    { evidenceIds: [] },
    { evidenceIds: ['missing'] },
    { evidenceIds: ['source-b'] },
    { value: '', status: 'reported' as const },
    { value: 'No limitations', status: 'not-reported' as const },
    { comparability: 'comparable' as const },
    { comparability: 'not-comparable' as const, comparabilityReason: '   ' }
  ])('rejects unsupported or inconsistent cells: %j', (patch) => {
    expect(() => updatePaperComparisonMatrix(matrix(), { cells: [cell(patch)] }, sources, after))
      .toThrow(PaperMatrixValidationError)
  })

  it('requires sources for comparability judgments even when the result is missing', () => {
    expect(() => updatePaperComparisonMatrix(matrix(), { cells: [cell({
      value: '', status: 'not-reported', evidenceIds: [],
      comparability: 'not-comparable', comparabilityReason: 'Different evaluation splits'
    })] }, sources, after)).toThrow('source evidence')
  })

  it('retains a reasoned, sourced comparability decision without treating it as verification', () => {
    const result = updatePaperComparisonMatrix(matrix(), { cells: [cell({
      comparability: 'not-comparable', comparabilityReason: 'Different evaluation splits',
      evidenceIds: ['source-a', 'source-a']
    })] }, sources, after)
    expect(result.cells[0].comparability).toBe('not-comparable')
    expect(result.cells[0].comparabilityReason).toBe('Different evaluation splits')
    expect(result.cells[0].evidenceIds).toEqual(['source-a'])
  })

  it('rejects unknown rows, axes and duplicate cell updates', () => {
    for (const patch of [{ unitDir: 'papers/b' }, { axis: 'dataset' as const }]) {
      expect(() => updatePaperComparisonMatrix(matrix(), { cells: [cell(patch)] }, sources, after))
        .toThrow('unknown row or axis')
    }
    expect(() => updatePaperComparisonMatrix(matrix(), { cells: [cell(), cell()] }, sources, after))
      .toThrow('duplicate cells')
  })

  it('supports all axes at the limit and rejects excess rows or oversized values', () => {
    const full = createPaperComparisonMatrix({
      id: 'full', title: 'Full', rows: Array.from({ length: 100 }, (_, n) => row(`papers/${n}`)),
      axes: [...PAPER_MATRIX_AXES], now: before
    })
    expect(full.cells).toHaveLength(100 * PAPER_MATRIX_AXES.length)
    expect(() => updatePaperComparisonMatrix(full, { addRows: [row('papers/extra')] }, [], after))
      .toThrow(PaperMatrixValidationError)
    expect(() => updatePaperComparisonMatrix(matrix(), { cells: [cell({ value: 'x'.repeat(16001) })] }, sources, after))
      .toThrow(PaperMatrixValidationError)
  })

  it('rejects incomplete grids, repeated rows/axes/cells and non-owned saved sources', () => {
    const good = matrix()
    for (const malformed of [
      { ...good, cells: good.cells.slice(1) },
      { ...good, cells: [good.cells[0], good.cells[0]] },
      { ...good, rows: [...good.rows, good.rows[0]] },
      { ...good, axes: [...good.axes, good.axes[0]] },
      { ...good, cells: [{ ...good.cells[0], evidenceIds: ['source-b'] }, good.cells[1]] }
    ]) {
      expect(() => assertPaperMatrixIntegrity(malformed, sources)).toThrow(PaperMatrixValidationError)
    }
  })
})
