import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperEvidence, PaperMatricesResult, PaperMatrixCell } from '../../../shared/paper/paper-evidence-types'
import { createPaperMatrix, readPaperMatrices, updatePaperMatrix } from './paper-matrix-service'
import { mutatePaperEvidenceWorkspace, readPaperEvidenceWorkspace } from './paper-evidence-store'

// Paper metadata imports the HTTP user-agent helper; persistence itself needs no Electron binary.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

function success(result: PaperMatricesResult) {
  if (!result.ok) throw new Error(result.message)
  return result
}

function source(id = 'source-a', unitDir = 'papers/a'): PaperEvidence {
  return {
    id, unitDir, sourceMarkId: `mark-${id}`, sourceKind: 'highlight', originalQuote: 'Accuracy 91%',
    anchor: { page: 1, rects: [[0, 0, 0.5, 0.1]] },
    interpretation: '', conditions: '', question: '', claimKind: 'author-reported', verification: 'unverified',
    paperVersion: {
      canonicalId: 'doi:10.1234/paper-a', citeKey: 'SuppliedKey', title: 'Paper A', pdfFile: 'paper.pdf',
      pdfSha256: 'a'.repeat(64), pdfBytes: 100, capturedAt: 'now'
    },
    mechanical: { versionBinding: 'bound', quoteMatch: 'matched', textPartial: false, checkedAt: 'now' },
    createdAt: 'now', updatedAt: 'now'
  }
}

function edit(patch: Partial<Omit<PaperMatrixCell, 'updatedAt'>> = {}): Omit<PaperMatrixCell, 'updatedAt'> {
  return {
    unitDir: 'papers/a', axis: 'result', value: 'Accuracy 91%', status: 'reported', evidenceIds: ['source-a'],
    comparability: 'unknown', comparabilityReason: '', ...patch
  }
}

describe('paper comparison matrix persistence', () => {
  let fixture = ''
  let root = ''
  let statePath = ''

  async function paper(dir: string, title = 'Paper A') {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'paper.json'), JSON.stringify({
      version: 2, slug: 'paper-a', title, authors: ['Author'], importedAt: '2026-10-01',
      doi: '10.1234/paper-a', bibtex: '@article{SuppliedKey, title={Paper A}}'
    }))
  }

  async function create() {
    return success(await createPaperMatrix(root, {
      title: 'Comparison', unitDirs: ['papers/a'], axes: ['result', 'limitations'], expectedRevision: 0
    }))
  }

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'paper-matrix-'))
    root = join(fixture, 'workspace')
    statePath = join(root, '.kun', 'paper-evidence', 'workspace.json')
    await paper(join(root, 'papers/a'))
    await paper(join(root, 'papers/b'), 'Paper B')
  })

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true })
  })

  it('starts empty and persists metadata-only rows with original BibTeX keys', async () => {
    expect(await readPaperMatrices(root)).toEqual({ ok: true, revision: 0, matrices: [] })
    const created = await create()
    expect(created.revision).toBe(1)
    expect(created.matrices[0].rows[0]).toEqual({
      unitDir: 'papers/a', title: 'Paper A', canonicalId: 'doi:10.1234/paper-a', citeKey: 'SuppliedKey'
    })
    expect(created.matrices[0].cells.every((cell) => cell.status === 'not-reported' && cell.value === '')).toBe(true)
    expect(await readPaperMatrices(root)).toEqual(created)
  })

  it('canonicalizes and deduplicates repeated rows and axes', async () => {
    const created = success(await createPaperMatrix(root, {
      title: 'Comparison', unitDirs: ['papers/a', './papers/a', join(root, 'papers/a')],
      axes: ['result', 'result'], expectedRevision: 0
    }))
    expect(created.matrices[0].rows).toHaveLength(1)
    expect(created.matrices[0].axes).toEqual(['result'])
  })

  it('preserves sourced manual edits through incremental additions and readback', async () => {
    const created = await create()
    const matrixId = created.matrices[0].id
    await mutatePaperEvidenceWorkspace(root, 1, (state) => { state.evidence.push(source()) })
    const edited = success(await updatePaperMatrix(root, {
      matrixId, expectedRevision: 2, patch: { cells: [edit()] }
    }))
    const expanded = success(await updatePaperMatrix(root, {
      matrixId, expectedRevision: 3,
      patch: { addUnitDirs: ['papers/a', 'papers/b', 'papers/b'], addAxes: ['dataset', 'result'] }
    }))
    expect(expanded.matrices[0].cells[0]).toEqual(edited.matrices[0].cells[0])
    expect(expanded.matrices[0].cells).toHaveLength(6)
    expect(expanded.matrices[0].cells.filter((cell) => cell.status === 'reported')).toHaveLength(1)
    expect(await readPaperMatrices(root)).toEqual(expanded)
  })

  it('rejects nonexistent, unowned, and unsourced cells without changing revision or bytes', async () => {
    const created = await create()
    await mutatePaperEvidenceWorkspace(root, 1, (state) => { state.evidence.push(source('source-b', 'papers/b')) })
    const original = await readFile(statePath, 'utf8')
    for (const patch of [
      { evidenceIds: ['missing'] }, { evidenceIds: ['source-b'] }, { evidenceIds: [] },
      { comparability: 'comparable' as const, evidenceIds: ['source-b'], comparabilityReason: '' }
    ]) {
      await expect(updatePaperMatrix(root, {
        matrixId: created.matrices[0].id, expectedRevision: 2, patch: { cells: [edit(patch)] }
      })).rejects.toMatchObject({ code: 'invalid-matrix' })
      expect(await readFile(statePath, 'utf8')).toBe(original)
    }
    expect((await readPaperEvidenceWorkspace(root)).revision).toBe(2)
  })

  it('serializes concurrent mutations and rejects the stale revision without lost edits', async () => {
    const created = await create()
    const matrixId = created.matrices[0].id
    const writes = await Promise.allSettled([
      updatePaperMatrix(root, { matrixId, expectedRevision: 1, patch: { title: 'First writer' } }),
      updatePaperMatrix(root, { matrixId, expectedRevision: 1, patch: { title: 'Second writer' } })
    ])
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(writes.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected', reason: { code: 'revision-conflict' }
    })
    const stored = success(await readPaperMatrices(root))
    expect(stored.revision).toBe(2)
    const winner = writes.find((result) => result.status === 'fulfilled')
    if (winner?.status !== 'fulfilled') throw new Error('A write should have succeeded')
    expect(stored).toEqual(winner.value)
  })

  it('rejects paths outside the workspace and missing or malformed paper units', async () => {
    await paper(join(fixture, 'outside'))
    await mkdir(join(root, 'broken'))
    await writeFile(join(root, 'broken', 'paper.json'), '{')
    for (const path of ['../outside', join(fixture, 'outside'), 'missing', 'broken']) {
      await expect(createPaperMatrix(root, {
        title: 'Invalid', unitDirs: [path], axes: ['result'], expectedRevision: 0
      })).rejects.toMatchObject({ code: 'invalid-unit' })
    }
    expect(await readPaperMatrices(root)).toEqual({ ok: true, revision: 0, matrices: [] })
  })

  it.skipIf(process.platform === 'win32')('rejects external symlink rows and metadata', async () => {
    await paper(join(fixture, 'outside'))
    await symlink(join(fixture, 'outside'), join(root, 'escape'))
    await mkdir(join(root, 'metadata-escape'))
    await symlink(join(fixture, 'outside', 'paper.json'), join(root, 'metadata-escape', 'paper.json'))
    for (const path of ['escape', 'metadata-escape']) {
      await expect(createPaperMatrix(root, {
        title: 'Invalid', unitDirs: [path], axes: ['result'], expectedRevision: 0
      })).rejects.toMatchObject({ code: 'invalid-unit' })
    }
  })

  it('refuses malformed source links already on disk and leaves the damaged file untouched', async () => {
    const created = await create()
    const malformed = await readPaperEvidenceWorkspace(root)
    malformed.matrices[0].cells[0] = { ...edit(), updatedAt: 'now' }
    const damaged = JSON.stringify(malformed)
    await writeFile(statePath, damaged)
    await expect(readPaperMatrices(root)).rejects.toMatchObject({ code: 'corrupt-store' })
    await expect(updatePaperMatrix(root, {
      matrixId: created.matrices[0].id, expectedRevision: 1, patch: { title: 'Overwrite' }
    })).rejects.toMatchObject({ code: 'corrupt-store' })
    expect(await readFile(statePath, 'utf8')).toBe(damaged)
  })

  it('validates unknown IDs, unexpected fields and request limits', async () => {
    await expect(updatePaperMatrix(root, {
      matrixId: 'missing', expectedRevision: 0, patch: { title: 'Unknown' }
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(createPaperMatrix(root, {
      title: 'Large', unitDirs: Array.from({ length: 101 }, () => 'papers/a'), axes: ['result'], expectedRevision: 0
    })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(updatePaperMatrix(root, {
      matrixId: 'missing', expectedRevision: 0, patch: { evidenceIds: [] } as never
    })).rejects.toMatchObject({ code: 'invalid-input' })
    expect((await readPaperEvidenceWorkspace(root)).revision).toBe(0)
  })
})
