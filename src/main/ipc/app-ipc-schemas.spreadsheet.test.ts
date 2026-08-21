import { describe, expect, it } from 'vitest'
import {
  workspaceSpreadsheetConvertPayloadSchema,
  workspaceSpreadsheetSavePayloadSchema
} from './app-ipc-schemas'
import {
  MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES,
  MAX_WORKSPACE_SPREADSHEET_MUTATIONS
} from '../../shared/workspace-spreadsheet'

const sha = 'a'.repeat(64)

describe('workspace spreadsheet IPC schemas', () => {
  it('accepts bounded cell, merge, row, and column mutations', () => {
    expect(workspaceSpreadsheetSavePayloadSchema.parse({
      path: 'reports/book.xlsx',
      workspaceRoot: '/workspace',
      expectedSha256: sha,
      mutations: [
        { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Ready', style: { bold: true } },
        { kind: 'merge', sheetName: 'Data', range: 'A2:B2', merged: true },
        { kind: 'row', sheetName: 'Data', index: 2, size: 24 },
        { kind: 'column', sheetName: 'Data', index: 2, hidden: false }
      ]
    })).toMatchObject({ mutations: expect.any(Array) })
  })

  it('rejects malformed addresses, unbounded mutations, and empty cell changes', () => {
    const base = {
      path: 'book.xlsx', workspaceRoot: '/workspace', expectedSha256: sha
    }
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      ...base,
      mutations: [{ kind: 'cell', sheetName: 'Data', address: '../A1', value: 1 }]
    }).success).toBe(false)
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      ...base,
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'XFE1', value: 1 }]
    }).success).toBe(false)
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      ...base,
      mutations: [{ kind: 'column', sheetName: 'Data', index: 16_385, size: 10 }]
    }).success).toBe(false)
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      ...base,
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1' }]
    }).success).toBe(false)
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      ...base,
      mutations: Array.from({ length: MAX_WORKSPACE_SPREADSHEET_MUTATIONS + 1 }, (_, index) => ({
        kind: 'cell', sheetName: 'Data', address: `A${index + 1}`, value: index
      }))
    }).success).toBe(false)
  })

  it('rejects a mutation payload over the byte budget', () => {
    const large = 'x'.repeat(32_767)
    const mutations = Array.from({ length: 65 }, (_, index) => ({
      kind: 'cell' as const,
      sheetName: 'Data',
      address: `A${index + 1}`,
      value: large
    }))
    expect(JSON.stringify(mutations).length).toBeGreaterThan(MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES)
    expect(workspaceSpreadsheetSavePayloadSchema.safeParse({
      path: 'book.xlsx', workspaceRoot: '/workspace', expectedSha256: sha, mutations
    }).success).toBe(false)
  })

  it('accepts only source-versioned XLS conversion requests', () => {
    expect(workspaceSpreadsheetConvertPayloadSchema.parse({
      path: 'legacy.xls', workspaceRoot: '/workspace', expectedSha256: sha
    })).toEqual({ path: 'legacy.xls', workspaceRoot: '/workspace', expectedSha256: sha })
    expect(workspaceSpreadsheetConvertPayloadSchema.safeParse({
      path: 'legacy.xls', workspaceRoot: '/workspace', expectedSha256: 'stale'
    }).success).toBe(false)
  })
})
