import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as xlsx from 'xlsx'
import { createWriteDocumentSession, emptyWriteEditorLayout } from '../../write/write-editor-layout'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import {
  applyWriteOfficePreviewUpdate,
  reconcileWriteOfficePreview,
  useWriteEditorGroupFileWatches
} from './use-write-editor-group-file-watches'
import {
  fingerprintSpreadsheetMutationTarget,
  sheetJsWorkbookToUniver,
  spreadsheetMutationTargetKey
} from '../../lib/workspace-univer-model'
import { readXlsxStyleOverrides } from '../../lib/workspace-xlsx-style-reader'
import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'

function WatchHarness(): ReactElement {
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const editorLayout = useWriteWorkspaceStore((state) => state.editorLayout)
  useWriteEditorGroupFileWatches({ workspaceRoot, editorLayout })
  return createElement('div')
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function spreadsheetPreview(values: unknown[][], sha: string) {
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(values), 'Data')
  const data = new Uint8Array(xlsx.write(workbook, { type: 'array', bookType: 'xlsx' }))
  return {
    ok: true as const,
    path: '/work/book.xlsx', name: 'book.xlsx', sourceFormat: 'xlsx' as const,
    renderFormat: 'xlsx' as const, viewer: 'spreadsheet' as const,
    size: data.byteLength, mtimeMs: 1, sourceSha256: sha, data
  }
}

async function mutationFingerprints(
  preview: ReturnType<typeof spreadsheetPreview>,
  mutations: WorkspaceSpreadsheetMutation[]
): Promise<Record<string, string>> {
  const parsed = xlsx.read(preview.data, {
    type: 'array', dense: false, cellDates: false, cellFormula: true,
    cellNF: true, cellStyles: true
  })
  const baseline = sheetJsWorkbookToUniver(
    parsed,
    preview.sourceSha256,
    preview.name,
    await readXlsxStyleOverrides(preview.data, parsed)
  ).baseline
  return Object.fromEntries(mutations.map((mutation) => [
    spreadsheetMutationTargetKey(mutation),
    fingerprintSpreadsheetMutationTarget(baseline, mutation)
  ]))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useWriteWorkspaceStore.setState({
    workspaceRoot: '',
    documentsByPath: {},
    editorLayout: emptyWriteEditorLayout()
  })
})

describe('useWriteEditorGroupFileWatches', () => {
  it('creates only one watcher when both visible groups show the same file', async () => {
    const watchWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      watchId: 'watch-1',
      path: '/work/shared.md',
      content: 'shared',
      size: 6,
      truncated: false,
      startedAt: '2026-08-12T00:00:00.000Z'
    }))
    const unwatchWorkspaceFile = vi.fn(async () => true)
    vi.stubGlobal('window', {
      kunGui: {
        watchWorkspaceFile,
        unwatchWorkspaceFile,
        onWorkspaceFileChanged: vi.fn(() => vi.fn())
      }
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const document = createWriteDocumentSession({
      path: '/work/shared.md',
      kind: 'text',
      fileContent: 'shared'
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      documentsByPath: { '/work/shared.md': document },
      editorLayout: {
        version: 1,
        orientation: 'horizontal',
        ratio: 0.5,
        focusedGroupId: 'primary',
        groups: [
          {
            id: 'primary',
            tabs: [{ path: '/work/shared.md', viewMode: 'live' }],
            activePath: '/work/shared.md'
          },
          {
            id: 'secondary',
            tabs: [{ path: '/work/shared.md', viewMode: 'preview' }],
            activePath: '/work/shared.md'
          }
        ]
      }
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WatchHarness))
      await flushPromises()
    })

    expect(watchWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(watchWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/work',
      path: '/work/shared.md'
    })

    await act(async () => {
      renderer.unmount()
      await flushPromises()
    })
    expect(unwatchWorkspaceFile).toHaveBeenCalledWith('watch-1')
  })

  it('refreshes a read-only code document from text watch snapshots', async () => {
    let onChanged: ((payload: {
      watchId: string
      ok: true
      path: string
      content: string
      size: number
      truncated: boolean
    }) => void) | undefined
    const watchWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      watchId: 'watch-code',
      path: '/work/app.ts',
      content: 'const baseline = true\n',
      size: 22,
      truncated: false,
      startedAt: '2026-08-13T00:00:00.000Z'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        watchWorkspaceFile,
        unwatchWorkspaceFile: vi.fn(async () => true),
        onWorkspaceFileChanged: vi.fn((listener: typeof onChanged) => {
          onChanged = listener
          return vi.fn()
        })
      }
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const document = createWriteDocumentSession({
      path: '/work/app.ts',
      kind: 'code',
      fileContent: 'const initial = true\n',
      persistedContent: 'const initial = true\n'
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      documentsByPath: { '/work/app.ts': document },
      editorLayout: {
        version: 1,
        orientation: 'single',
        ratio: 0.5,
        focusedGroupId: 'primary',
        groups: [{
          id: 'primary',
          tabs: [{ path: '/work/app.ts', viewMode: 'source' }],
          activePath: '/work/app.ts'
        }]
      }
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WatchHarness))
      await flushPromises()
    })

    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/app.ts']).toMatchObject({
      kind: 'code',
      fileContent: 'const baseline = true\n',
      persistedContent: 'const baseline = true\n',
      saveStatus: 'saved'
    })

    await act(async () => {
      onChanged?.({
        watchId: 'watch-code',
        ok: true,
        path: '/work/app.ts',
        content: 'const refreshed = true\n',
        size: 23,
        truncated: false
      })
      await flushPromises()
    })

    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/app.ts']).toMatchObject({
      kind: 'code',
      fileContent: 'const refreshed = true\n',
      persistedContent: 'const refreshed = true\n',
      fileSize: 23,
      fileTruncated: false,
      saveStatus: 'saved'
    })

    await act(async () => renderer.unmount())
  })

  it('retains dirty XLSX edits as a conflict until the external version is reloaded', () => {
    const original = {
      ok: true as const,
      path: '/work/book.xlsx',
      name: 'book.xlsx',
      sourceFormat: 'xlsx' as const,
      renderFormat: 'xlsx' as const,
      viewer: 'spreadsheet' as const,
      size: 10,
      mtimeMs: 1,
      sourceSha256: 'a'.repeat(64),
      data: new Uint8Array([1])
    }
    const external = {
      ...original,
      mtimeMs: 2,
      sourceSha256: 'b'.repeat(64),
      data: new Uint8Array([2])
    }
    const document = createWriteDocumentSession({
      path: original.path,
      kind: 'office',
      officePreview: original,
      spreadsheetMutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Local' }],
      saveStatus: 'dirty'
    })
    const conflicted = applyWriteOfficePreviewUpdate(document, external, 'External conflict')
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      documentsByPath: { [original.path]: conflicted },
      editorLayout: {
        ...emptyWriteEditorLayout(),
        groups: [{
          id: 'primary',
          tabs: [{ path: original.path, viewMode: 'rich' }],
          activePath: original.path
        }]
      }
    })

    act(() => useWriteWorkspaceStore.getState().reloadSpreadsheetConflict(original.path))
    const reloaded = useWriteWorkspaceStore.getState().documentsByPath[original.path]
    expect(conflicted).toMatchObject({
      officePreview: { sourceSha256: original.sourceSha256 },
      spreadsheetConflictPreview: { sourceSha256: external.sourceSha256 },
      spreadsheetMutations: expect.arrayContaining([expect.objectContaining({ value: 'Local' })]),
      saveStatus: 'error'
    })
    expect(reloaded).toMatchObject({
      officePreview: { sourceSha256: external.sourceSha256 },
      spreadsheetConflictPreview: null,
      spreadsheetMutations: [],
      saveStatus: 'saved'
    })
  })

  it('accepts a successful local-save preview echo even when a later local edit is dirty', () => {
    const oldPreview = {
      ok: true as const,
      path: '/work/book.xlsx', name: 'book.xlsx', sourceFormat: 'xlsx' as const,
      renderFormat: 'xlsx' as const, viewer: 'spreadsheet' as const, size: 10,
      mtimeMs: 1, sourceSha256: 'a'.repeat(64), data: new Uint8Array([1])
    }
    const savedPreview = {
      ...oldPreview,
      sourceSha256: 'b'.repeat(64),
      mtimeMs: 2,
      data: new Uint8Array([2])
    }
    const document = createWriteDocumentSession({
      path: oldPreview.path,
      kind: 'office',
      officePreview: oldPreview,
      spreadsheetSourceSha256: savedPreview.sourceSha256,
      spreadsheetMutations: [{ kind: 'cell', sheetName: 'Data', address: 'B2', value: 'later edit' }],
      saveStatus: 'dirty'
    })

    expect(applyWriteOfficePreviewUpdate(document, savedPreview, 'External conflict')).toMatchObject({
      officePreview: { sourceSha256: savedPreview.sourceSha256 },
      spreadsheetSourceSha256: savedPreview.sourceSha256,
      spreadsheetConflictPreview: null,
      spreadsheetMutations: [{ kind: 'cell', sheetName: 'Data', address: 'B2', value: 'later edit' }],
      saveStatus: 'dirty',
      fileError: null
    })
  })

  it('automatically rebases local mutations when an external XLSX changes different targets', async () => {
    const original = spreadsheetPreview([['original', 'stable']], 'd'.repeat(64))
    const external = spreadsheetPreview([['original', 'external']], 'e'.repeat(64))
    const mutations: WorkspaceSpreadsheetMutation[] = [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'local' }
    ]
    const document = createWriteDocumentSession({
      path: original.path,
      kind: 'office',
      officePreview: original,
      spreadsheetMutations: mutations,
      spreadsheetMutationBaseFingerprints: await mutationFingerprints(original, mutations),
      saveStatus: 'dirty'
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      activeFilePath: original.path,
      activeFileKind: 'office',
      documentsByPath: { [original.path]: document }
    })

    await reconcileWriteOfficePreview(original.path, external)
    expect(useWriteWorkspaceStore.getState().documentsByPath[original.path]).toMatchObject({
      officePreview: { sourceSha256: external.sourceSha256 },
      spreadsheetSourceSha256: external.sourceSha256,
      spreadsheetMutations: mutations,
      spreadsheetConflictPreview: null,
      spreadsheetConflictTargets: [],
      saveStatus: 'dirty',
      fileError: null
    })
  })

  it('keeps overlapping targets blocked and drops only conflicts when external wins', async () => {
    const original = spreadsheetPreview([['original', 'stable', 'third']], 'f'.repeat(64))
    const external = spreadsheetPreview([['external', 'stable', 'third']], '1'.repeat(64))
    const mutations: WorkspaceSpreadsheetMutation[] = [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'local A' },
      { kind: 'cell', sheetName: 'Data', address: 'C1', value: 'local C' }
    ]
    const document = createWriteDocumentSession({
      path: original.path,
      kind: 'office',
      officePreview: original,
      spreadsheetMutations: mutations,
      spreadsheetMutationBaseFingerprints: await mutationFingerprints(original, mutations),
      saveStatus: 'dirty'
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      activeFilePath: original.path,
      activeFileKind: 'office',
      documentsByPath: { [original.path]: document }
    })

    await reconcileWriteOfficePreview(original.path, external)
    let state = useWriteWorkspaceStore.getState().documentsByPath[original.path]
    expect(state).toMatchObject({
      officePreview: { sourceSha256: original.sourceSha256 },
      spreadsheetConflictPreview: { sourceSha256: external.sourceSha256 },
      spreadsheetConflictTargets: ['cell:Data:A1'],
      saveStatus: 'error'
    })

    const conflicted = state
    useWriteWorkspaceStore.getState().resolveSpreadsheetConflict(original.path, 'keep-local')
    expect(useWriteWorkspaceStore.getState().documentsByPath[original.path]).toMatchObject({
      officePreview: { sourceSha256: external.sourceSha256 },
      spreadsheetMutations: mutations,
      spreadsheetConflictPreview: null,
      saveStatus: 'dirty'
    })

    useWriteWorkspaceStore.setState((current) => ({
      documentsByPath: { ...current.documentsByPath, [original.path]: conflicted }
    }))
    useWriteWorkspaceStore.getState().resolveSpreadsheetConflict(original.path, 'use-external')
    state = useWriteWorkspaceStore.getState().documentsByPath[original.path]
    expect(state).toMatchObject({
      officePreview: { sourceSha256: external.sourceSha256 },
      spreadsheetSourceSha256: external.sourceSha256,
      spreadsheetMutations: [mutations[1]],
      spreadsheetConflictPreview: null,
      spreadsheetConflictTargets: [],
      saveStatus: 'dirty'
    })
  })
})
