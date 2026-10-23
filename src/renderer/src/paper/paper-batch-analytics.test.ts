import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createThread: vi.fn(async () => ({ id: 'paper-thread' })),
  sendUserMessage: vi.fn(async (_thread: string, _text: string, _options: { clientRequestId?: string }) => ({ turnId: 'paper-turn' })),
  getThreadState: vi.fn(async () => ({ latestTurnId: 'paper-turn', latestTurnStatus: 'completed' })),
  notice: vi.fn(), material: vi.fn(), refresh: vi.fn(async () => {})
}))
vi.mock('../agent/registry', () => ({ getProvider: () => mocks }))
vi.mock('../store/chat-store', () => ({ useChatStore: { setState: vi.fn(), getState: () => ({ refreshThreads: mocks.refresh }) } }))
vi.mock('../write/write-thread-registry', () => ({
  markWriteThread: () => ({}), readWriteThreadRegistry: () => ({}), saveWriteThreadRegistry: vi.fn(), writeThreadIdsForFile: () => []
}))
vi.mock('../write/write-workspace-store', () => ({ useWriteWorkspaceStore: { getState: () => ({ workspaceRoot: '/workspace' }) }, writeJoinPath: (a: string, b: string) => a + '/' + b }))
vi.mock('../write/paper/paper-store', () => ({ usePaperStore: { getState: () => ({ setNotice: mocks.notice }) } }))
import { startPaperBatchInterpret, usePaperBatchInterpret, type PaperBatchPaper } from './paper-batch-interpret'
import { setProductCapture } from '../product-analytics/client'
import { clearWorkAnalytics, noteWorkTurnCompleted, noteWorkVisibleFeedback } from '../product-analytics/work'
const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
const input = () => ({ workspaceRoot: '/workspace', papers: [{ unitDir: 'paper', meta: { title: 'Private title', arxivId: '1234.56789' } } as PaperBatchPaper],
  purpose: 'quick-screen' as const, skipExisting: false, providerId: 'provider', model: 'model', language: 'en', t: (key: string) => key })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('window', { kunGui: { productAnalytics: { track }, paperEvidenceMaterial: mocks.material } })
  vi.clearAllMocks(); clearWorkAnalytics(); setProductCapture(false)
  usePaperBatchInterpret.setState({ job: null, request: null })
  mocks.material.mockResolvedValue({ ok: true, sourceText: 'Private document content', abstractOnly: false, textPartial: false })
  mocks.sendUserMessage.mockResolvedValue({ turnId: 'paper-turn' })
})
afterEach(() => { setProductCapture(false); clearWorkAnalytics(); vi.unstubAllGlobals() })

describe('paper batch explicit Work analytics', () => {
  it('keeps the original provider payload and result flow for historical users without consent', async () => {
    await startPaperBatchInterpret(input())
    expect(mocks.sendUserMessage).toHaveBeenCalledOnce()
    expect(mocks.sendUserMessage.mock.calls[0][2]).not.toHaveProperty('clientRequestId')
    expect(usePaperBatchInterpret.getState().job?.items[0].status).toBe('done')
    expect(track).not.toHaveBeenCalled()
  })

  it('marks and correlates a user-selected paper with its actual Work root turn', async () => {
    setProductCapture(true, epoch)
    await startPaperBatchInterpret(input())
    expect(mocks.sendUserMessage.mock.calls[0][2].clientRequestId).toMatch(new RegExp(`^turn_work_${epoch}_`))
    noteWorkTurnCompleted('paper-thread', 'paper-turn'); noteWorkVisibleFeedback('paper-thread', 'paper-turn', 'text', true)
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(4))
    expect(track.mock.calls.map(([e]) => (e as { name: string }).name)).toEqual([
      'work_task_submitted', 'work_submission_finished', 'work_feedback_presented', 'result_presented'
    ])
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/Private|paper-thread|paper-turn/)
  })

  it('does not acquire consent or a new actor during asynchronous paper preparation', async () => {
    for (const initial of [undefined, epoch]) {
      usePaperBatchInterpret.setState({ job: null })
      setProductCapture(Boolean(initial), initial)
      mocks.material.mockImplementationOnce(async () => {
        setProductCapture(true, 'bf5bcf48-b546-4b2e-bab1-154f8fa31f56')
        return { ok: true, sourceText: 'Private document', abstractOnly: false, textPartial: false }
      })
      await startPaperBatchInterpret(input())
    }
    expect(mocks.sendUserMessage.mock.calls.every(call => !call[2].clientRequestId)).toBe(true)
    expect(track).not.toHaveBeenCalled()
  }, 10000)

  it('keeps a lost provider response unknown instead of reporting an execution failure', async () => {
    setProductCapture(true, epoch)
    mocks.sendUserMessage.mockRejectedValueOnce(new Error('socket closed after write'))
    await startPaperBatchInterpret(input())
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2))
    expect(track.mock.calls[1][0]).toMatchObject({ name: 'work_submission_finished', properties: { requestOutcome: 'unknown' } })
    expect(usePaperBatchInterpret.getState().job?.items[0].status).toBe('failed') // Existing UI result is unchanged.
  })
})
