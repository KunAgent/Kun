/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperStore } from '../write/paper/paper-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperFreshFolders } from './paper-import-fresh'
import { findImportItem, runPaperImport, undoPaperImport, usePaperImportJobs } from './paper-import-job'
import { planPaperImport, type ImportCandidate } from './paper-import-plan'

const ROOT = '/Users/me/space'
const t = (key: string, options?: Record<string, unknown>): string => `${key}${options ? JSON.stringify(options) : ''}`

function candidate(key: string, extra: Partial<ImportCandidate> = {}): ImportCandidate {
  return { key, keys: [key, `title:${key}`], title: `Paper ${key}`, input: `2401.${key}`, ...extra }
}

type Bridge = Record<string, ReturnType<typeof vi.fn>>

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    paperCreateGroup: vi.fn(async ({ group }: { group: string }) => ({ ok: true, group })),
    paperImportBatch: vi.fn(async ({ items, parentDir }: { items: Array<{ input: string }>; parentDir: string }) => ({
      ok: true,
      results: items.map((item) => ({ input: item.input, ok: true, unitDir: `${parentDir}/${item.input}`, reused: false }))
    })),
    paperLibraryList: vi.fn(async () => ({ ok: true, entries: [], counts: {}, tags: [], groups: [] })),
    paperTrashUnit: vi.fn(async () => ({ ok: true })),
    paperCancel: vi.fn(async () => undefined),
    ...overrides
  }
  ;(window as unknown as { kunGui: Bridge }).kunGui = bridge
  return bridge
}

describe('paper import job', () => {
  beforeEach(() => {
    useWriteWorkspaceStore.setState({
      workspaceRoot: ROOT,
      paperReading: { ...useWriteWorkspaceStore.getState().paperReading, papersDir: 'papers' }
    })
    usePaperImportJobs.setState({ jobs: {} })
    usePaperFreshFolders.setState({ byRoot: {}, version: 0 })
    usePaperStore.getState().setNotice(null)
  })
  afterEach(() => {
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('creates folders, imports one paper at a time and marks the target folders fresh', async () => {
    const bridge = installBridge()
    const plan = planPaperImport(
      [candidate('1', { group: 'A' }), candidate('2', { group: 'B' }), candidate('3', { group: 'A' })],
      { folder: 'topic', byGroup: true, owned: 'keep' }
    )
    await runPaperImport({ scope: 's', plan, folder: 'topic', t })

    expect(bridge.paperCreateGroup.mock.calls.map(([arg]) => arg.group).sort()).toEqual(['topic/A', 'topic/B'])
    expect(bridge.paperImportBatch).toHaveBeenCalledTimes(3)
    const parents = bridge.paperImportBatch.mock.calls.map(([arg]) => arg.parentDir)
    expect(parents).toEqual(['papers/topic/A', 'papers/topic/A', 'papers/topic/B'])
    const job = usePaperImportJobs.getState().jobs.s!
    expect(job.running).toBe(false)
    expect(job.items.map((item) => item.status)).toEqual(['imported', 'imported', 'imported'])
    expect(usePaperFreshFolders.getState().byRoot['/Users/me/space']).toEqual({ 'topic/A': 2, 'topic/B': 1 })
    const notice = usePaperStore.getState().notice
    expect(notice?.message).toContain('paperImportDoneToFolder')
    expect(notice?.action?.label).toBe('paperImportUndo')
  })

  it('records failures per paper and keeps going', async () => {
    const bridge = installBridge({
      paperImportBatch: vi.fn(async ({ items }: { items: Array<{ input: string }> }) =>
        items[0]!.input === '2401.2'
          ? { ok: true, results: [{ input: '2401.2', ok: false, code: 'network', message: 'offline' }] }
          : { ok: true, results: [{ input: items[0]!.input, ok: true, unitDir: `papers/${items[0]!.input}`, reused: false }] })
    })
    const plan = planPaperImport([candidate('1'), candidate('2'), candidate('3')], { folder: 'topic', byGroup: false, owned: 'keep' })
    await runPaperImport({ scope: 's', plan, folder: 'topic', t })
    const job = usePaperImportJobs.getState().jobs.s!
    expect(job.items.map((item) => item.status)).toEqual(['imported', 'failed', 'imported'])
    expect(findImportItem(job, ['title:2'])?.message).toBe('offline')
    expect(bridge.paperImportBatch).toHaveBeenCalledTimes(3)
    expect(usePaperStore.getState().notice?.message).toContain('paperImportDonePartial')
  })

  it('marks imported papers without a PDF as metadata only', async () => {
    installBridge({
      paperLibraryList: vi.fn(async () => ({
        ok: true,
        entries: [{ unitDir: 'papers/topic/2401.1', hasPdf: false }, { unitDir: 'papers/topic/2401.2', hasPdf: true }],
        counts: {},
        tags: [],
        groups: []
      }))
    })
    const plan = planPaperImport([candidate('1'), candidate('2')], { folder: 'topic', byGroup: false, owned: 'keep' })
    await runPaperImport({ scope: 's', plan, folder: 'topic', t })
    expect(usePaperImportJobs.getState().jobs.s!.items.map((item) => item.status)).toEqual(['metadata', 'imported'])
  })

  it('does not re-import papers the library already has and undo trashes only new units', async () => {
    const bridge = installBridge({
      paperImportBatch: vi.fn(async ({ items, parentDir }: { items: Array<{ input: string }>; parentDir: string }) => ({
        ok: true,
        results: items.map((item) => ({
          input: item.input,
          ok: true,
          unitDir: `${parentDir}/${item.input}`,
          reused: item.input === '2401.2'
        }))
      }))
    })
    const owned = candidate('9', { owned: { unitDir: 'papers/old', group: '' } })
    const plan = planPaperImport([candidate('1'), candidate('2'), owned], { folder: 'topic', byGroup: false, owned: 'keep' })
    await runPaperImport({ scope: 's', plan, folder: 'topic', t })
    expect(bridge.paperImportBatch).toHaveBeenCalledTimes(2)
    const job = usePaperImportJobs.getState().jobs.s!
    expect(job.items.map((item) => item.status)).toEqual(['imported', 'reused', 'kept'])

    await undoPaperImport('s', t)
    expect(bridge.paperTrashUnit).toHaveBeenCalledTimes(1)
    expect(bridge.paperTrashUnit.mock.calls[0]![0].unitDir).toBe('papers/topic/2401.1')
    expect(usePaperStore.getState().notice?.message).toContain('paperImportUndone')
  })

  it('stops between papers when canceled', async () => {
    const bridge = installBridge()
    const plan = planPaperImport([candidate('1'), candidate('2')], { folder: 'topic', byGroup: false, owned: 'keep' })
    bridge.paperImportBatch.mockImplementationOnce(async ({ items }: { items: Array<{ input: string }> }) => {
      usePaperImportJobs.getState().patchJob('s', (job) => ({ ...job, canceled: true }))
      return { ok: true, results: [{ input: items[0]!.input, ok: true, unitDir: 'papers/topic/x', reused: false }] }
    })
    await runPaperImport({ scope: 's', plan, folder: 'topic', t })
    expect(usePaperImportJobs.getState().jobs.s!.items.map((item) => item.status)).toEqual(['imported', 'canceled'])
  })
})
