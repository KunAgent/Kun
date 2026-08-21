import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearWriteSpreadsheetEditorRegistrationsForTests,
  commitWriteSpreadsheetEditorSave,
  finishWriteSpreadsheetEditorSave,
  prepareWriteSpreadsheetEditorSave,
  registerWriteSpreadsheetEditor
} from './write-spreadsheet-editor-coordinator'

afterEach(clearWriteSpreadsheetEditorRegistrationsForTests)

describe('write spreadsheet editor coordinator', () => {
  it('selects the focused editor and completes its captured save token', async () => {
    const secondaryPrepare = vi.fn(async () => ({ token: 'secondary', mutations: [] }))
    const primaryPrepare = vi.fn(async () => ({
      token: 'primary',
      mutations: [{ kind: 'cell' as const, sheetName: 'Data', address: 'A1', value: 'final' }]
    }))
    const setSaving = vi.fn()
    registerWriteSpreadsheetEditor('/work/book.xlsx', {
      isFocused: () => false,
      prepareSave: secondaryPrepare,
      commitSave: () => ({ mutations: [] }),
      setSaving: vi.fn()
    })
    registerWriteSpreadsheetEditor('/work/book.xlsx', {
      isFocused: () => true,
      prepareSave: primaryPrepare,
      commitSave: (token, sourceSha256) => ({
        mutations: [{ kind: 'cell', sheetName: token, address: 'B2', value: sourceSha256 }]
      }),
      setSaving
    })

    const coordinated = await prepareWriteSpreadsheetEditorSave('/work/book.xlsx')
    expect(primaryPrepare).toHaveBeenCalledOnce()
    expect(secondaryPrepare).not.toHaveBeenCalled()
    expect(setSaving).toHaveBeenCalledWith(true)
    expect(commitWriteSpreadsheetEditorSave(
      '/work/book.xlsx', coordinated!.registrationId, coordinated!.prepared.token, 'b'.repeat(64)
    )).toEqual({
      mutations: [{ kind: 'cell', sheetName: 'primary', address: 'B2', value: 'b'.repeat(64) }]
    })
    finishWriteSpreadsheetEditorSave('/work/book.xlsx', coordinated!.registrationId)
    expect(setSaving).toHaveBeenLastCalledWith(false)
  })

  it('unlocks the editor when active-cell preparation fails', async () => {
    const setSaving = vi.fn()
    registerWriteSpreadsheetEditor('/work/book.xlsx', {
      isFocused: () => true,
      prepareSave: async () => { throw new Error('cell commit failed') },
      commitSave: () => ({ mutations: [] }),
      setSaving
    })
    await expect(prepareWriteSpreadsheetEditorSave('/work/book.xlsx')).rejects.toThrow('cell commit failed')
    expect(setSaving.mock.calls).toEqual([[true], [false]])
  })
})
