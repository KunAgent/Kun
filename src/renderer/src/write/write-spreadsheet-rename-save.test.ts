import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { WorkspaceSpreadsheetSavePayload, WorkspaceSpreadsheetSaveResult } from '@shared/workspace-spreadsheet'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { clearWriteWorkspaceSaveQueueForTests } from './write-save-coordinator'
import {
  clearWriteSpreadsheetEditorRegistrationsForTests,
  registerWriteSpreadsheetEditor,
  prepareWriteSpreadsheetEditorSave
} from './write-spreadsheet-editor-coordinator'
import { reconcileWriteOfficePreview } from '../components/write/use-write-editor-group-file-watches'

const store = (): ReturnType<typeof useWriteWorkspaceStore.getState> => useWriteWorkspaceStore.getState()
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
let root: string
let failSave: boolean
let saveSheet: ReturnType<typeof vi.fn>
async function preview(file: string): Promise<WorkspaceOfficePreviewSuccess> {
  const data = await fs.readFile(file)
  return {
    ok: true, path: file, name: path.basename(file), sourceFormat: 'xlsx', renderFormat: 'xlsx',
    viewer: 'spreadsheet', size: data.length, mtimeMs: 1, sourceSha256: digest(data), data: new Uint8Array(data)
  }
}
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kun-sheet-rename-')))
  failSave = false
  // OfficeCLI is the external boundary; the stand-in applies mutations to a real XLSX on disk.
  saveSheet = vi.fn(async (payload: WorkspaceSpreadsheetSavePayload): Promise<WorkspaceSpreadsheetSaveResult> => {
    if (failSave) return { ok: false, code: 'mutation_failed', message: 'OfficeCLI failed' }
    const data = await fs.readFile(payload.path)
    expect(digest(data)).toBe(payload.expectedSha256)
    const workbook = XLSX.read(data, { type: 'buffer' })
    for (const mutation of payload.mutations) {
      if (mutation.kind === 'cell') workbook.Sheets[mutation.sheetName][mutation.address] = { t: 's', v: String(mutation.value ?? '') }
    }
    const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    await fs.writeFile(payload.path, output)
    return { ok: true, path: payload.path, sourceSha256: digest(output), size: output.length, mtimeMs: 2, appliedMutations: payload.mutations.length }
  })
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined }, confirm: vi.fn(() => true),
    kunGui: {
      readWorkspaceOfficePreview: async ({ path: file }: { path: string }) => preview(file),
      saveWorkspaceSpreadsheet: saveSheet,
      renameWorkspaceEntry: async ({ path: previousPath, newName }: { path: string; newName: string }) => {
        const nextPath = path.join(path.dirname(previousPath), newName)
        await fs.rename(previousPath, nextPath)
        return { ok: true, previousPath, path: nextPath, renamedAt: new Date().toISOString() }
      },
      listWorkspaceDirectory: async ({ path: dir }: { path?: string }) => ({ ok: true, root: dir || root, entries: [] })
    }
  })
  useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root, autoSaveEnabled: true })
})
afterEach(async () => {
  store().resetWorkspace()
  clearWriteSpreadsheetEditorRegistrationsForTests()
  clearWriteWorkspaceSaveQueueForTests()
  vi.unstubAllGlobals()
  await fs.rm(root, { recursive: true, force: true })
})
async function open(relative = 'book.xlsx'): Promise<string> {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['baseline']]), 'Data')
  await fs.writeFile(file, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  await store().openFile(root, file)
  return file
}
function activeEditor(file: string): {
  edit: (value: string) => void
  endEditingAsync: ReturnType<typeof vi.fn>
  unregister: () => void
} {
  let active = 'baseline'
  let baseline = 'baseline'
  let committed = active
  const snapshots = new Map<string, string>()
  const endEditingAsync = vi.fn(async (accept: boolean) => { expect(accept).toBe(true); committed = active; return true })
  const unregister = registerWriteSpreadsheetEditor(file, {
    isFocused: () => true,
    setSaving: vi.fn(),
    prepareSave: async () => {
      await endEditingAsync(true)
      const token = String(snapshots.size + 1)
      snapshots.set(token, committed)
      return { token, mutations: committed === baseline ? [] : [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: committed }] }
    },
    commitSave: (token) => { baseline = snapshots.get(token)!; return { mutations: [] } }
  }, store().documentsByPath[file].documentEpoch)
  return { edit: (value) => { active = value }, endEditingAsync, unregister }
}
async function cell(file: string): Promise<string> {
  return XLSX.read(await fs.readFile(file), { type: 'buffer' }).Sheets.Data.A1.v
}

describe('XLSX rename retains the live editor before its new preview arrives', () => {
  it.each(['file', 'case', 'directory'] as const)('saves and closes the newest active cell after %s rename', async (kind) => {
    const file = await open(kind === 'directory' ? 'folder/book.xlsx' : 'book.xlsx')
    const oldPreview = store().documentsByPath[file].officePreview
    const editor = activeEditor(file)
    const nextFile = kind === 'directory' ? path.join(root, 'renamed/book.xlsx') : path.join(root, kind === 'case' ? 'Book.xlsx' : 'renamed.xlsx')
    await store().renameEntry(root, kind === 'directory' ? path.dirname(file) : file, kind === 'directory' ? 'renamed' : path.basename(nextFile))
    expect(store().documentsByPath[nextFile].officePreview).toBe(oldPreview)
    expect(oldPreview?.path).toBe(file)
    editor.edit('after rename, before preview')
    expect(await store().saveDocument(root, nextFile)).toBe(true)
    expect(editor.endEditingAsync).toHaveBeenCalledOnce()
    expect(saveSheet).toHaveBeenLastCalledWith(expect.objectContaining({ path: nextFile, mutations: [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'after rename, before preview' }
    ] }))
    expect(await cell(nextFile)).toBe('after rename, before preview')
    // This edit has not reached any debounced store mutation: close must still snapshot the live cell.
    expect(store().documentsByPath[nextFile].saveStatus).toBe('saved')
    editor.edit('last active edit before close')
    expect(await store().closeTab('primary', nextFile)).toBe(true)
    expect(editor.endEditingAsync).toHaveBeenCalledTimes(2)
    expect(await cell(nextFile)).toBe('last active edit before close')
    expect(saveSheet.mock.calls.every(([payload]) => payload.path === nextFile)).toBe(true)
    const listing = await fs.readdir(kind === 'directory' ? root : path.dirname(nextFile))
    expect(listing).not.toContain(kind === 'directory' ? 'folder' : 'book.xlsx')
    expect(store().documentsByPath[nextFile]).toBeUndefined()
    editor.unregister()
  })

  it('retains the prepared active-cell draft on failure and leaves its tab open for retry', async () => {
    const file = await open()
    const editor = activeEditor(file)
    const nextFile = path.join(root, 'renamed.xlsx')
    await store().renameEntry(root, file, 'renamed.xlsx')
    editor.edit('must survive OfficeCLI failure')
    failSave = true
    expect(await store().closeTab('primary', nextFile)).toBe(false)
    expect(store().documentsByPath[nextFile]).toMatchObject({ saveStatus: 'error', spreadsheetMutations: [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'must survive OfficeCLI failure' }
    ] })
    expect(await cell(nextFile)).toBe('baseline')
    failSave = false
    expect(await store().saveDocument(root, nextFile)).toBe(true)
    expect(await cell(nextFile)).toBe('must survive OfficeCLI failure')
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    editor.unregister()
  })

  it('does not apply a delayed pre-save preview over the new persisted baseline', async () => {
    const file = await open()
    const editor = activeEditor(file)
    const nextFile = path.join(root, 'renamed.xlsx')
    await store().renameEntry(root, file, 'renamed.xlsx')
    const document = store().documentsByPath[nextFile]
    const pendingPreview = await preview(nextFile)
    const identity = { workspaceRoot: root, documentEpoch: document.documentEpoch, sourceSha256: document.spreadsheetSourceSha256 }
    let deliver!: (value: WorkspaceOfficePreviewSuccess) => void
    const applyingPreview = new Promise<WorkspaceOfficePreviewSuccess>((resolve) => { deliver = resolve })
      .then((result) => reconcileWriteOfficePreview(nextFile, result, identity))
    editor.edit('new disk baseline')
    expect(await store().saveDocument(root, nextFile)).toBe(true)
    const saved = store().documentsByPath[nextFile]
    deliver(pendingPreview)
    await applyingPreview
    expect(store().documentsByPath[nextFile]).toEqual(saved)
    editor.unregister()
  })

  it('isolates equal-content replacement epochs and late old-path cleanup after rename', async () => {
    const file = await open()
    const oldEditor = activeEditor(file)
    const nextFile = path.join(root, 'renamed.xlsx')
    await store().renameEntry(root, file, 'renamed.xlsx')
    const stalePreview = await preview(nextFile)
    const identity = { workspaceRoot: root, documentEpoch: store().documentsByPath[nextFile].documentEpoch }
    await store().closeTab('primary', nextFile, true)
    await store().openFile(root, nextFile)
    const replacement = activeEditor(nextFile)
    oldEditor.unregister()
    replacement.edit('replacement epoch edit')
    const current = store().documentsByPath[nextFile]
    expect(current.documentEpoch).not.toBe(identity.documentEpoch)
    expect(current.officePreview?.sourceSha256).toBe(stalePreview.sourceSha256)
    await reconcileWriteOfficePreview(nextFile, stalePreview, identity)
    expect(store().documentsByPath[nextFile]).toEqual(current)
    expect(await store().saveDocument(root, nextFile)).toBe(true)
    expect(replacement.endEditingAsync).toHaveBeenCalledOnce()
    expect(oldEditor.endEditingAsync).not.toHaveBeenCalled()
    expect(await cell(nextFile)).toBe('replacement epoch edit')
    await expect(prepareWriteSpreadsheetEditorSave(nextFile, identity.documentEpoch)).rejects.toThrow('another document instance')
    expect(await prepareWriteSpreadsheetEditorSave(file, identity.documentEpoch)).toBeNull()
    replacement.unregister()
  })
})
