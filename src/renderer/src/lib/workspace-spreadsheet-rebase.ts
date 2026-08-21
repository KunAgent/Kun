import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'
import {
  fingerprintSpreadsheetMutationTarget,
  sheetJsWorkbookToUniver,
  spreadsheetMutationTargetKey
} from './workspace-univer-model'
import { readXlsxStyleOverrides } from './workspace-xlsx-style-reader'

export type SpreadsheetExternalRebase = {
  sourceSha256: string
  conflictTargets: string[]
  externalBaseFingerprints: Record<string, string>
}

export async function evaluateSpreadsheetExternalRebase(input: {
  preview: WorkspaceOfficePreviewSuccess
  mutations: WorkspaceSpreadsheetMutation[]
  baseFingerprints: Record<string, string>
}): Promise<SpreadsheetExternalRebase> {
  if (input.preview.sourceFormat !== 'xlsx' || input.preview.renderFormat !== 'xlsx') {
    throw new Error('Spreadsheet rebase requires an XLSX preview.')
  }
  const xlsx = await import('xlsx')
  const parsed = xlsx.read(input.preview.data, {
    type: 'array', dense: false, cellDates: false, cellFormula: true,
    cellNF: true, cellStyles: true
  })
  const styleOverrides = await readXlsxStyleOverrides(input.preview.data, parsed)
  const external = sheetJsWorkbookToUniver(
    parsed,
    input.preview.sourceSha256,
    input.preview.name,
    styleOverrides
  ).baseline
  const externalBaseFingerprints: Record<string, string> = {}
  const conflictTargets: string[] = []
  for (const mutation of input.mutations) {
    const key = spreadsheetMutationTargetKey(mutation)
    const externalFingerprint = fingerprintSpreadsheetMutationTarget(external, mutation)
    externalBaseFingerprints[key] = externalFingerprint
    if (!input.baseFingerprints[key] || input.baseFingerprints[key] !== externalFingerprint) {
      conflictTargets.push(key)
    }
  }
  return {
    sourceSha256: input.preview.sourceSha256,
    conflictTargets,
    externalBaseFingerprints
  }
}

export function spreadsheetConflictTargetLabel(target: string): string {
  const [kind, sheetName, location] = target.split(':')
  if (!kind || !sheetName || !location) return target
  if (kind === 'cell' || kind === 'merge') return `${sheetName}!${location}`
  return `${sheetName}!${kind === 'row' ? `Row ${location}` : `Column ${location}`}`
}
