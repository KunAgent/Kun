import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))
import { createAdmissionHarness } from './chat-store-admission-test-support'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { setProductCapture } from '../product-analytics/client'
import { beginWorkSubmission, clearWorkAnalytics, observeWorkSubmission } from '../product-analytics/work'

const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('window', { kunGui: {
    getSettings: async () => ({ agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } }, codePromptPrefix: '', chatWelcomeMessage: '' }),
    logError: async () => {}, productAnalytics: { track }
  } })
  rendererRuntimeClient.invalidateSettings(); setProductCapture(true, epoch); clearWorkAnalytics(); track.mockClear()
})
afterEach(() => { setProductCapture(false); clearWorkAnalytics(); rendererRuntimeClient.invalidateSettings(); vi.unstubAllGlobals() })

describe('real ChatStore admission analytics', () => {
  it('records unknown when the POST response is lost, keeping the exact existing retry behavior', async () => {
    const sendUserMessage = vi.fn(async () => { throw new Error('socket closed after request write') })
    registry.getProvider.mockReturnValue({ sendUserMessage })
    const { actions, state } = createAdmissionHarness()
    state.busy = false; state.recoverActiveTurn = vi.fn(async () => false)
    const submission = beginWorkSubmission()!
    let sent: boolean | undefined
    await observeWorkSubmission(submission, async () => {
      sent = await actions.sendMessage('private work request', 'agent', { clientRequestId: submission.clientRequestId, agentSurface: 'write' })
      return sent ? 'accepted' : 'failed'
    })
    expect(sent).toBe(false)
    expect(state.queuedMessages).toEqual([expect.objectContaining({ clientRequestId: submission.clientRequestId, deliveryState: 'pending' })])
    await vi.waitFor(() => expect(track.mock.calls.map(([event]) => event)).toContainEqual(expect.objectContaining({
      name: 'work_submission_finished', properties: expect.objectContaining({ requestOutcome: 'unknown' })
    })))
    expect(JSON.stringify(track.mock.calls)).not.toContain('private work request')
    expect(JSON.stringify(track.mock.calls)).not.toContain('"requestOutcome":"failed"')
  })
})
