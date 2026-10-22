import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setProductCapture } from './client'
import {
  beginWorkSubmission, bindWorkAnalyticsTurn, captureWorkDocumentAction, captureWorkResultAction,
  clearWorkAnalytics, noteWorkTurnCompleted, noteWorkVisibleFeedback, observeWorkSubmission, saveWorkDocumentExplicitly
} from './work'

const EPOCH = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const OTHER = 'bf5bcf48-b546-4b2e-bab1-154f8fa31f56'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
const events = () => track.mock.calls.map(([event]) => event as unknown as { name: string; properties: Record<string, unknown> })
async function drain() { await vi.waitFor(() => expect(events().some(event => event.name === 'work_task_submitted')).toBe(true)) }

beforeEach(() => {
  vi.stubGlobal('window', { kunGui: { productAnalytics: { track } } })
  vi.stubGlobal('crypto', webcrypto)
  setProductCapture(true, EPOCH)
  clearWorkAnalytics(); track.mockClear()
})
afterEach(() => { setProductCapture(false); clearWorkAnalytics(); vi.unstubAllGlobals() })

describe('Work explicit task and consent attribution', () => {
  it('keeps normal execution unchanged without consent, including older hosts', async () => {
    setProductCapture(false)
    const send = vi.fn(async () => 'accepted' as const)
    expect(beginWorkSubmission()).toBeUndefined()
    await observeWorkSubmission(undefined, send)
    expect(send).toHaveBeenCalledOnce()
    captureWorkDocumentAction('copy')()
    expect(track).not.toHaveBeenCalled()
  })

  it('records one submission and local admission without inventing a runtime start', async () => {
    const submission = beginWorkSubmission()!
    expect(submission.clientRequestId).toMatch(new RegExp(`^turn_work_${EPOCH}_[0-9a-f-]{36}$`))
    await observeWorkSubmission(submission, async () => 'accepted')
    submission.finish('failed')
    await drain()
    expect(events().map(event => event.name)).toEqual(['work_task_submitted', 'work_submission_finished'])
    expect(events()[1].properties).toMatchObject({ mode: 'work', requestOutcome: 'accepted' })
    expect(events()[0].properties.runKey).toMatch(/^[a-f0-9]{64}$/)
    expect(events()[1].properties.runKey).toBe(events()[0].properties.runKey)
  })

  it('counts preparation failure and propagates an unknown thrown business error', async () => {
    await observeWorkSubmission(beginWorkSubmission(), async () => undefined)
    await expect(observeWorkSubmission(beginWorkSubmission(), async () => { throw new Error('private prompt path') })).rejects.toThrow('private prompt path')
    await vi.waitFor(() => expect(events().filter(event => event.name === 'work_submission_finished')).toHaveLength(2))
    expect(events().filter(event => event.name === 'work_submission_finished').map(event => event.properties.requestOutcome)).toEqual(['failed', 'unknown'])
    expect(JSON.stringify(events())).not.toContain('private prompt path')
  })

  it('binds queue/direct retries once and excludes child threads, historical turns and auto continuation', async () => {
    const submission = beginWorkSubmission()!
    bindWorkAnalyticsTurn(submission.clientRequestId, 'parent', 'turn')
    bindWorkAnalyticsTurn(submission.clientRequestId, 'parent', 'turn')
    noteWorkVisibleFeedback('child', 'turn', 'text', true)
    noteWorkVisibleFeedback('parent', 'historical', 'text', true)
    bindWorkAnalyticsTurn('automatic-request', 'parent', 'auto')
    noteWorkVisibleFeedback('parent', 'auto', 'text', true)
    noteWorkVisibleFeedback('parent', 'turn', 'reasoning')
    noteWorkVisibleFeedback('parent', 'turn', 'tool')
    noteWorkTurnCompleted('parent', 'turn')
    noteWorkVisibleFeedback('parent', 'turn', 'text', true)
    noteWorkVisibleFeedback('parent', 'turn', 'text', true)
    await vi.waitFor(() => expect(events()).toHaveLength(3))
    expect(events().map(event => event.name)).toEqual(['work_task_submitted', 'work_feedback_presented', 'result_presented'])
    expect(events()[1].properties.feedbackKind).toBe('reasoning')
    expect(new Set(events().map(event => event.properties.runKey)).size).toBe(1)
  })

  it('drops pending hashes, admission and saved callbacks after consent or account epoch changes', async () => {
    const submission = beginWorkSubmission()!
    const copied = captureWorkDocumentAction('copy')
    setProductCapture(true, OTHER)
    bindWorkAnalyticsTurn(submission.clientRequestId, 'parent', 'turn')
    noteWorkVisibleFeedback('parent', 'turn', 'text', true)
    submission.finish('accepted'); copied()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(track).not.toHaveBeenCalled()
  })

  it('records AI result actions only after actual presentation and binds async action to its actor', async () => {
    const submission = beginWorkSubmission()!
    bindWorkAnalyticsTurn(submission.clientRequestId, 'parent', 'turn')
    captureWorkResultAction('parent', 'turn', 'copy')()
    const earlierCopy = captureWorkResultAction('parent', 'turn', 'copy')
    noteWorkTurnCompleted('parent', 'turn')
    noteWorkVisibleFeedback('parent', 'turn', 'text', true)
    earlierCopy()
    captureWorkResultAction('child', 'turn', 'export')()
    captureWorkResultAction('parent', 'turn', 'copy')()
    await vi.waitFor(() => expect(events().filter(event => event.name === 'result_action')).toHaveLength(1))
    const exported = captureWorkResultAction('parent', 'turn', 'export')
    setProductCapture(true, OTHER); exported()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events().filter(event => event.name === 'result_action')).toHaveLength(1)
  })

  it('keeps explicit document save separate from result adoption and requires save success', async () => {
    expect(await saveWorkDocumentExplicitly(async () => false)).toBe(false)
    expect(track).not.toHaveBeenCalled()
    expect(await saveWorkDocumentExplicitly(async () => true)).toBe(true)
    expect(events()).toEqual([{ name: 'work_document_action', properties: { mode: 'work', action: 'save' } }])
    await saveWorkDocumentExplicitly(async () => { setProductCapture(false); return true })
    expect(events()).toHaveLength(1)
  })

  it('does not acquire desktop analytics authority on Remote web', () => {
    vi.stubGlobal('window', { kunGui: { isRemoteWeb: true, productAnalytics: { track } } })
    expect(beginWorkSubmission()).toBeUndefined()
    captureWorkDocumentAction('export')()
    expect(track).not.toHaveBeenCalled()
  })
})
