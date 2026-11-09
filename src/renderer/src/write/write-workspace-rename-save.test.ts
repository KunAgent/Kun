import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { clearWriteWorkspaceSaveQueueForTests, enqueueWriteWorkspaceFileTask } from './write-save-coordinator'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

let root: string
let writeGate: ReturnType<typeof deferred> | undefined
let renameGate: ReturnType<typeof deferred> | undefined
let failWrite = false
let failRename = false
const store = (): ReturnType<typeof useWriteWorkspaceStore.getState> => useWriteWorkspaceStore.getState()
const writeFile = vi.fn(async ({ path: file, content }: { path: string; content: string }) => {
  const gate = writeGate
  writeGate = undefined
  await gate?.promise
  if (failWrite) return { ok: false as const, message: 'disk full' }
  await fs.writeFile(file, content, 'utf8')
  return { ok: true as const, path: file, savedAt: new Date().toISOString() }
})
const renameEntry = vi.fn(async ({ path: previousPath, newName }: { path: string; newName: string }) => {
  const gate = renameGate
  renameGate = undefined
  await gate?.promise
  if (failRename) throw new Error('rename denied')
  const nextPath = path.join(path.dirname(previousPath), newName)
  await fs.rename(previousPath, nextPath)
  return { ok: true as const, previousPath, path: nextPath, renamedAt: new Date().toISOString() }
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kun-write-rename-'))
  failWrite = false
  failRename = false
  writeFile.mockClear()
  renameEntry.mockClear()
  vi.stubGlobal('window', { kunGui: {
    writeWorkspaceFile: writeFile,
    renameWorkspaceEntry: renameEntry,
    readWorkspaceFile: async ({ path: file }: { path: string }) => {
      const content = await fs.readFile(file, 'utf8')
      return { ok: true, path: file, content, size: Buffer.byteLength(content), truncated: false }
    },
    listWorkspaceDirectory: async ({ path: directory }: { path?: string }) => ({
      ok: true, root: directory || root, entries: []
    })
  } })
  useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root })
})

afterEach(async () => {
  store().resetWorkspace()
  clearWriteWorkspaceSaveQueueForTests()
  writeGate = undefined
  renameGate = undefined
  vi.unstubAllGlobals()
  await fs.rm(root, { recursive: true, force: true })
})

async function open(relative = 'draft.md'): Promise<string> {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'baseline')
  await store().openFile(root, file)
  return file
}

function expectSaved(file: string, content: string): void {
  expect(store().documentsByPath[file]).toMatchObject({
    path: file, fileContent: content, persistedContent: content, saveStatus: 'saved', fileError: null
  })
}

describe('Markdown save and rename filesystem ordering', () => {
  it.each([false, true])('waits for an in-flight save before rename (directory=%s)', async (directory) => {
    const file = await open(directory ? 'folder/draft.md' : 'draft.md')
    const gate = deferred()
    writeGate = gate
    store().setFileContent('first edit')
    const saving = store().saveDocument(root, file)
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))
    const renaming = store().renameEntry(root, directory ? path.dirname(file) : file, 'renamed')
    store().setFileContent('latest edit')
    // This request must not bypass the rename reservation or retain the old path.
    const queuedSaving = store().saveDocument(root, file)
    await Promise.resolve()
    expect(renameEntry).not.toHaveBeenCalled()
    gate.resolve()
    expect(await saving).toBe(true)
    const renamed = await renaming
    const nextFile = directory ? path.join(root, 'renamed/draft.md') : path.join(root, 'renamed.md')
    expect(renamed).toBe(directory ? path.dirname(nextFile) : nextFile)
    expect(await queuedSaving).toBe(true)
    expect(await fs.readFile(nextFile, 'utf8')).toBe('latest edit')
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expectSaved(nextFile, 'latest edit')
    expect(store().saveStatus).toBe('saved')
  })

  it('holds new saves during rename and follows consecutive renames', async () => {
    const file = await open()
    const gate = deferred()
    renameGate = gate
    const renaming = store().renameEntry(root, file, 'second')
    await vi.waitFor(() => expect(renameEntry).toHaveBeenCalledTimes(1))
    store().setFileContent('during rename')
    const saving = store().saveDocument(root, file)
    const again = store().renameEntry(root, file, 'third')
    await Promise.resolve()
    expect(writeFile).not.toHaveBeenCalled()
    gate.resolve()
    await renaming
    expect(await saving).toBe(true)
    expect(await again).toBe(path.join(root, 'third.md'))
    expectSaved(path.join(root, 'third.md'), 'during rename')
    expect(await fs.readFile(path.join(root, 'third.md'), 'utf8')).toBe('during rename')
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(root, 'second.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains failed save content through rename and allows retry at the new path', async () => {
    const file = await open()
    const gate = deferred()
    writeGate = gate
    failWrite = true
    store().setFileContent('must survive')
    const saving = store().saveDocument(root, file)
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))
    const renaming = store().renameEntry(root, file, 'second')
    gate.resolve()
    expect(await saving).toBe(false)
    const next = await renaming
    expect(next).toBe(path.join(root, 'second.md'))
    expect(store().documentsByPath[next!]).toMatchObject({
      fileContent: 'must survive', persistedContent: 'baseline', saveStatus: 'error'
    })
    failWrite = false
    expect(await store().saveDocument(root, next!)).toBe(true)
    expectSaved(next!, 'must survive')
    expect(await fs.readFile(next!, 'utf8')).toBe('must survive')
  })

  it('rejects a stale background task queued during rename instead of recreating its source', async () => {
    const file = await open()
    const gate = deferred()
    renameGate = gate
    const renaming = store().renameEntry(root, file, 'second')
    await vi.waitFor(() => expect(renameEntry).toHaveBeenCalledTimes(1))
    const writeOldPath = vi.fn(async () => { await fs.writeFile(file, 'stale background result') })
    const background = enqueueWriteWorkspaceFileTask(root, file, writeOldPath)
    const rejected = expect(background).rejects.toThrow('Document moved')
    gate.resolve()
    await renaming
    await rejected
    expect(writeOldPath).not.toHaveBeenCalled()
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(root, 'second.md'), 'utf8')).toBe('baseline')
  })

  it('does not apply save completion to a replacement session at the same path', async () => {
    const file = await open()
    const gate = deferred()
    writeGate = gate
    store().setFileContent('old session save')
    const saving = store().saveDocument(root, file)
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))
    const replacement = {
      ...store().documentsByPath[file],
      documentEpoch: store().documentsByPath[file].documentEpoch + 1,
      fileContent: 'replacement draft',
      persistedContent: 'replacement baseline',
      saveStatus: 'dirty' as const
    }
    useWriteWorkspaceStore.setState({
      documentsByPath: { [file]: replacement },
      documentEpoch: replacement.documentEpoch,
      fileContent: replacement.fileContent,
      persistedContent: replacement.persistedContent,
      saveStatus: 'dirty'
    })
    gate.resolve()
    expect(await saving).toBe(true)
    expect(store().documentsByPath[file]).toEqual(replacement)
    expect(store().saveStatus).toBe('dirty')
  })

  it('releases a rejected rename without redirecting saves or losing edits', async () => {
    const file = await open()
    const gate = deferred()
    renameGate = gate
    failRename = true
    const renaming = store().renameEntry(root, file, 'second')
    await vi.waitFor(() => expect(renameEntry).toHaveBeenCalledTimes(1))
    store().setFileContent('retry original path')
    const saving = store().saveDocument(root, file)
    gate.resolve()
    expect(await renaming).toBeNull()
    expect(await saving).toBe(true)
    expectSaved(file, 'retry original path')
    expect(await fs.readFile(file, 'utf8')).toBe('retry original path')
    await expect(fs.stat(path.join(root, 'second.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
