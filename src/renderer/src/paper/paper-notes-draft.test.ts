/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { editPaperNotesDraft, loadPaperNotesDraft, preparePaperNotesForNavigation, savePaperNotesDraft, usePaperNotesDraftStore } from './paper-notes-draft'
import { paperSpaceItemKey } from './paper-space-store'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('../lib/confirm-dialog', () => ({ confirmDialog: confirm }))
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }))
const read = vi.fn()
const write = vi.fn()
const create = vi.fn()
const key = paperSpaceItemKey('/legacy', 'papers/a')

beforeEach(() => {
  vi.clearAllMocks()
  usePaperNotesDraftStore.setState({ drafts: {} })
  read.mockResolvedValue({ ok: true, content: 'saved notes', mtimeMs: 1 })
  write.mockResolvedValue({ ok: true, mtimeMs: 2 })
  Object.assign(window, { kunGui: { readWorkspaceFile: read, writeWorkspaceFile: write, createWorkspaceFile: create } })
})
afterEach(() => {
  usePaperNotesDraftStore.setState({ drafts: {} })
  delete (window as unknown as { kunGui?: unknown }).kunGui
})

describe('source-scoped paper notes', () => {
  it('keeps same-named unit drafts separate and preserves unsaved text across reloads/routes', async () => {
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'private draft')
    await loadPaperNotesDraft('/other', 'papers/a')
    await loadPaperNotesDraft('/legacy', 'papers/a')
    expect(read).toHaveBeenCalledTimes(2)
    expect(usePaperNotesDraftStore.getState().drafts[key].text).toBe('private draft')
    expect(usePaperNotesDraftStore.getState().drafts[paperSpaceItemKey('/other', 'papers/a')].text).toBe('saved notes')
  })

  it('writes to the explicit source with an mtime check, preserving a conflicted draft', async () => {
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'local edits')
    write.mockResolvedValueOnce({ ok: false, code: 'modified_on_disk', message: 'conflict' })
    expect(await savePaperNotesDraft(key)).toBe(false)
    expect(write).toHaveBeenCalledWith({ workspaceRoot: '/legacy', path: 'papers/a/NOTES.md', content: 'local edits', expectedMtimeMs: 1 })
    expect(usePaperNotesDraftStore.getState().drafts[key]).toMatchObject({ text: 'local edits', saved: 'saved notes', mtimeMs: 1, saving: false })
  })

  it('does not overwrite typing made while the saved snapshot is in flight', async () => {
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'snapshot')
    let settle!: (result: unknown) => void
    write.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const saving = savePaperNotesDraft(key)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    editPaperNotesDraft(key, 'typed later')
    settle({ ok: true, mtimeMs: 2 })
    expect(await saving).toBe(false)
    expect(usePaperNotesDraftStore.getState().drafts[key]).toMatchObject({ text: 'typed later', saved: 'snapshot', mtimeMs: 2 })
    expect(await savePaperNotesDraft(key)).toBe(true)
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'typed later', expectedMtimeMs: 2 }))
  })

  it('creates missing notes without overwriting a file that appeared in the meantime', async () => {
    read.mockResolvedValueOnce({ ok: false, code: 'not_found', message: 'missing' })
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'new notes')
    create.mockResolvedValueOnce({ ok: false, message: 'file already exists' })
    expect(await savePaperNotesDraft(key)).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ workspaceRoot: '/legacy', path: 'papers/a/NOTES.md', content: 'new notes' })
    expect(usePaperNotesDraftStore.getState().drafts[key].text).toBe('new notes')
  })

  it('blocks navigation on canceled discard or failed save without clearing notes', async () => {
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'important')
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    expect(await preparePaperNotesForNavigation()).toBe(false)
    expect(usePaperNotesDraftStore.getState().drafts[key].text).toBe('important')
    confirm.mockResolvedValueOnce(true)
    write.mockResolvedValueOnce({ ok: false, message: 'disk unavailable' })
    expect(await preparePaperNotesForNavigation()).toBe(false)
    expect(usePaperNotesDraftStore.getState().drafts[key].text).toBe('important')
  })

  it('can retry after a synchronous bridge error instead of retaining a settled save promise', async () => {
    await loadPaperNotesDraft('/legacy', 'papers/a')
    editPaperNotesDraft(key, 'retry me')
    write.mockImplementationOnce(() => { throw new Error('bridge stopped') })
    expect(await savePaperNotesDraft(key)).toBe(false)
    expect(await savePaperNotesDraft(key)).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
  })
})
