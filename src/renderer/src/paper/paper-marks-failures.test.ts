/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activatePaperMarksUnit, getPaperMarksDraft, newPaperHighlight, removePaperHighlight, setPaperMarkCardComment, upsertPaperHighlight, usePaperMarksStore } from './paper-marks-store'
import { flushPaperMarks, usePaperMarks } from './use-paper-marks'
import { usePaperStore } from '../write/paper/paper-store'

const read = vi.fn()
const write = vi.fn()
let tree: ReactTestRenderer | undefined
const mark = (id: string, sha = 'a'.repeat(64)) => ({ ...newPaperHighlight({ color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: id, pdfSha256: sha }), id })
function Hook({ root }: { root: string }) { usePaperMarks(root, 'papers/a'); return null }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  usePaperMarksStore.setState(usePaperMarksStore.getInitialState(), true)
  usePaperStore.getState().setNotice(null)
  read.mockReset().mockResolvedValue({ ok: true, items: [] })
  write.mockReset().mockImplementation(async ({ items }: { items: unknown[] }) => ({ ok: true, items }))
  Object.assign(window, { kunGui: { paperMarksRead: read, paperMarksWrite: write } })
})
afterEach(async () => {
  usePaperMarksStore.setState({ dirty: false })
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as { kunGui?: unknown }).kunGui
})

describe('recoverable source-owned marks', () => {
  it('reports write failures, retains edits and exposes a working retry action', async () => {
    activatePaperMarksUnit('/legacy', 'papers/a')
    const highlight = mark('local')
    upsertPaperHighlight(highlight)
    write.mockResolvedValueOnce({ ok: false, message: 'Read-only source' })
    await flushPaperMarks('/legacy', 'papers/a')
    expect(usePaperMarksStore.getState()).toMatchObject({ dirty: true, items: [highlight] })
    const notice = usePaperStore.getState().notice
    expect(notice).toMatchObject({ tone: 'error', message: expect.stringContaining('Read-only source') })
    notice!.action!.run()
    await vi.waitFor(() => expect(usePaperMarksStore.getState().dirty).toBe(false))
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('restores failed drafts across identical unit paths in different roots and retries without replacing the active source', async () => {
    activatePaperMarksUnit('/legacy', 'papers/a')
    const a = mark('a')
    upsertPaperHighlight(a)
    write.mockRejectedValueOnce(new Error('offline'))
    await flushPaperMarks('/legacy', 'papers/a')
    const retry = usePaperStore.getState().notice!.action!.run
    activatePaperMarksUnit('/other', 'papers/a')
    const b = mark('b', 'b'.repeat(64))
    upsertPaperHighlight(b)
    activatePaperMarksUnit('/legacy', 'papers/a')
    expect(usePaperMarksStore.getState().items).toEqual([a])
    activatePaperMarksUnit('/other', 'papers/a')
    retry()
    await vi.waitFor(() => expect(getPaperMarksDraft('/legacy', 'papers/a')).toBeUndefined())
    expect(write.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceRoot: '/legacy', unitDir: 'papers/a', items: [a] })
    expect(usePaperMarksStore.getState()).toMatchObject({ workspaceRoot: '/other', dirty: true, items: [b] })
  })

  it('keeps card edits made during a write dirty and never adds cards to highlight items', async () => {
    activatePaperMarksUnit('/legacy', 'papers/a')
    const card = { id: 'visual', kind: 'visual', comment: 'before', updatedAt: '2026-01-01' }
    usePaperMarksStore.setState({ cards: { visual: card }, dirty: true })
    let finish!: (value: unknown) => void
    write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = flushPaperMarks('/legacy', 'papers/a')
    setPaperMarkCardComment('visual', 'after')
    finish({ ok: true, items: [card] })
    await saving
    expect(usePaperMarksStore.getState()).toMatchObject({ dirty: true, items: [], cards: { visual: { comment: 'after' } } })
  })

  it('does not resurrect a highlight deleted while its old snapshot was being written', async () => {
    activatePaperMarksUnit('/legacy', 'papers/a')
    const highlight = mark('deleted')
    upsertPaperHighlight(highlight)
    let finish!: (value: unknown) => void
    write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = flushPaperMarks('/legacy', 'papers/a')
    removePaperHighlight('deleted')
    finish({ ok: true, items: [highlight] })
    await saving
    expect(usePaperMarksStore.getState()).toMatchObject({ items: [], dirty: true, removedIds: ['deleted'] })
  })

  it('reports read failures and merges retried reads without losing local edits', async () => {
    activatePaperMarksUnit('/legacy', 'papers/a')
    const local = mark('local')
    upsertPaperHighlight(local)
    read.mockResolvedValueOnce({ ok: false, message: 'Cannot read marks' })
    await act(async () => { tree = create(createElement(Hook, { root: '/legacy' })) })
    expect(usePaperStore.getState().notice).toMatchObject({ tone: 'error', message: expect.stringContaining('Cannot read marks') })
    const remote = mark('remote')
    read.mockResolvedValueOnce({ ok: true, items: [remote] })
    await act(async () => { usePaperStore.getState().notice!.action!.run() })
    expect(usePaperMarksStore.getState().items.map((item) => item.id).sort()).toEqual(['local', 'remote'])
  })

  it('ignores late reads from a previous source', async () => {
    let finish!: (value: unknown) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const fresh = mark('other')
    read.mockResolvedValueOnce({ ok: true, items: [fresh] })
    await act(async () => { tree = create(createElement(Hook, { root: '/legacy' })) })
    await act(async () => { tree!.update(createElement(Hook, { root: '/other' })) })
    await act(async () => { finish({ ok: true, items: [mark('old')] }) })
    expect(usePaperMarksStore.getState()).toMatchObject({ workspaceRoot: '/other', items: [fresh] })
  })
})
