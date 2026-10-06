import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoundedPaperReading } from '../../../paper/paper-reading-entry'
import { usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { usePaperStore } from '../../../write/paper/paper-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { deferred, entry } from './paper-evidence-test-support'

let readUnit: ReturnType<typeof vi.fn>
const input = { workspaceRoot: '/library', unitDir: entry.unitDir, question: 'Which assumptions are reported?' }
const resolved = { ok: true, unitDir: entry.unitDir, meta: entry.meta, figures: null }
beforeEach(() => {
  readUnit = vi.fn(async () => resolved)
  vi.stubGlobal('window', { kunGui: { paperReadUnit: readUnit } })
  usePaperReadingRequest.setState({ request: null })
  usePaperStore.setState({ notice: null })
  useWriteWorkspaceStore.setState({ workspaceRoot: input.workspaceRoot, activeFilePath: '/library/papers/a/paper.pdf' })
})
afterEach(() => vi.unstubAllGlobals())

describe('bounded reading metadata recovery', () => {
  it('reads local metadata before opening a request when the library index has no entry', async () => {
    const pending = deferred<unknown>()
    readUnit.mockImplementation(() => pending.promise)
    const result = openBoundedPaperReading(input)
    expect(usePaperReadingRequest.getState().request).toBeNull()
    pending.resolve(resolved)
    expect(await result).toBe(true)
    expect(readUnit).toHaveBeenCalledWith({ workspaceRoot: '/library', unitDir: entry.unitDir })
    expect(usePaperReadingRequest.getState().request).toEqual({ ...input, meta: entry.meta })
  })

  it('uses supplied metadata without an unnecessary read', async () => {
    expect(await openBoundedPaperReading({ ...input, meta: entry.meta })).toBe(true)
    expect(readUnit).not.toHaveBeenCalled()
  })

  it('fails closed with the exact local read error instead of opening an unscoped request', async () => {
    readUnit.mockResolvedValue({ ok: false, code: 'io', message: 'Local paper metadata is unavailable' })
    expect(await openBoundedPaperReading(input)).toBe(false)
    expect(usePaperReadingRequest.getState().request).toBeNull()
    expect(usePaperStore.getState().notice).toEqual({ tone: 'error', message: 'Local paper metadata is unavailable' })
  })

  it.each(['workspace', 'document'])('abandons delayed metadata after active %s changes', async (scope) => {
    const pending = deferred<unknown>()
    readUnit.mockImplementation(() => pending.promise)
    const result = openBoundedPaperReading(input)
    useWriteWorkspaceStore.setState(scope === 'workspace' ? { workspaceRoot: '/another-library' } : { activeFilePath: '/library/papers/b/paper.pdf' })
    pending.resolve(resolved)
    expect(await result).toBe(false)
    expect(usePaperReadingRequest.getState().request).toBeNull()
    expect(usePaperStore.getState().notice).toBeNull()
  })

  it('does not replace a newer dialog with delayed metadata', async () => {
    const pending = deferred<unknown>()
    readUnit.mockImplementation(() => pending.promise)
    const result = openBoundedPaperReading(input)
    const next = { ...input, meta: entry.meta, question: 'A newer independently opened request' }
    usePaperReadingRequest.getState().open(next)
    pending.resolve(resolved)
    expect(await result).toBe(false)
    expect(usePaperReadingRequest.getState().request).toEqual(next)
  })

  it('allows only the latest metadata request to open a dialog', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    readUnit.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const obsolete = openBoundedPaperReading({ ...input, question: 'Old question' })
    const latest = openBoundedPaperReading({ ...input, question: 'Latest question' })
    second.resolve(resolved)
    expect(await latest).toBe(true)
    first.resolve(resolved)
    expect(await obsolete).toBe(false)
    expect(usePaperReadingRequest.getState().request?.question).toBe('Latest question')
  })
})
