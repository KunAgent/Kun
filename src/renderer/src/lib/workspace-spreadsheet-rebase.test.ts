import * as xlsx from 'xlsx'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'
import {
  fingerprintSpreadsheetMutationTarget,
  sheetJsWorkbookToUniver,
  spreadsheetMutationTargetKey
} from './workspace-univer-model'
import { evaluateSpreadsheetExternalRebase } from './workspace-spreadsheet-rebase'
import { readXlsxStyleOverrides } from './workspace-xlsx-style-reader'

function workbook(a1: string, b1: string): xlsx.WorkBook {
  const value = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(value, xlsx.utils.aoa_to_sheet([[a1, b1]]), 'Data')
  return value
}

function preview(value: xlsx.WorkBook, sha: string) {
  return {
    ok: true as const,
    path: '/work/book.xlsx', name: 'book.xlsx', sourceFormat: 'xlsx' as const,
    renderFormat: 'xlsx' as const, viewer: 'spreadsheet' as const,
    size: 100, mtimeMs: 1, sourceSha256: sha,
    data: new Uint8Array(xlsx.write(value, { type: 'array', bookType: 'xlsx' }))
  }
}

async function baseline(value: ReturnType<typeof preview>) {
  const parsed = xlsx.read(value.data, {
    type: 'array', dense: false, cellDates: false, cellFormula: true,
    cellNF: true, cellStyles: true
  })
  return sheetJsWorkbookToUniver(
    parsed,
    value.sourceSha256,
    value.name,
    await readXlsxStyleOverrides(value.data, parsed)
  ).baseline
}

describe('spreadsheet external rebase', () => {
  const mutation: WorkspaceSpreadsheetMutation = {
    kind: 'cell', sheetName: 'Data', address: 'A1', value: 'local'
  }
  const key = spreadsheetMutationTargetKey(mutation)

  it('rebases when the external version changes a different target', async () => {
    const original = await baseline(preview(workbook('original', 'stable'), 'a'.repeat(64)))
    const baseFingerprints = { [key]: fingerprintSpreadsheetMutationTarget(original, mutation) }
    await expect(evaluateSpreadsheetExternalRebase({
      preview: preview(workbook('original', 'external'), 'b'.repeat(64)),
      mutations: [mutation],
      baseFingerprints
    })).resolves.toMatchObject({
      sourceSha256: 'b'.repeat(64),
      conflictTargets: [],
      externalBaseFingerprints: { [key]: baseFingerprints[key] }
    })
  })

  it('reports the exact target when both versions change the same cell', async () => {
    const original = await baseline(preview(workbook('original', 'stable'), 'a'.repeat(64)))
    const baseFingerprints = { [key]: fingerprintSpreadsheetMutationTarget(original, mutation) }
    const result = await evaluateSpreadsheetExternalRebase({
      preview: preview(workbook('external', 'stable'), 'c'.repeat(64)),
      mutations: [mutation],
      baseFingerprints
    })
    expect(result.conflictTargets).toEqual([key])
    expect(result.externalBaseFingerprints[key]).not.toBe(baseFingerprints[key])
  })
})
