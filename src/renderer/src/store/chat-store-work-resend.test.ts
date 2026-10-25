import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))
import { createMaintenanceActions } from './chat-store-maintenance-actions'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { setProductCapture } from '../product-analytics/client'
import { clearWorkAnalytics } from '../product-analytics/work'
const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
function fixture() {
  const rewindThread = vi.fn(async () => {})
  const sendMessage = vi.fn(async (_text: string, _mode?: string, _options?: { clientRequestId?: string }) => true)
  registry.getProvider.mockReturnValue({ rewindThread })
  const state = {
    route: 'write', activeThreadId: 'work-thread', workspaceRoot: '/workspace', busy: false,
    blocks: [{ kind: 'user', id: 'user-1', text: 'old prompt', meta: { turnId: 'old-turn' } }],
    queuedMessages: [], threads: [{ id: 'work-thread', workspace: '/workspace', agentSurface: 'write' }],
    turnStartedAtByUserId: {}, turnDurationByUserId: {}, turnReasoningFirstAtByUserId: {}, turnReasoningLastAtByUserId: {},
    sendMessage, lastSeq: 0
  } as unknown as ChatState
  const set: ChatStoreSet = update => { Object.assign(state, typeof update === 'function' ? update(state) : update) }
  return { state, sendMessage, rewindThread, actions: createMaintenanceActions({ set, get: () => state, sseAbortRef: { current: null } }, {
    prepareCodeCanvasResend: async () => null, requestCodeCanvasPanelOpen: () => {}
  }) }
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('window', { kunGui: { productAnalytics: { track } } })
  track.mockClear(); clearWorkAnalytics(); setProductCapture(false)
})
afterEach(() => { setProductCapture(false); clearWorkAnalytics(); vi.unstubAllGlobals() })
describe('explicit Work edit and resend', () => {
  it('preserves old send arguments and emits nothing without consent', async () => {
    const f = fixture(); await f.actions.rewindAndResend('user-1', 'edited')
    expect(f.rewindThread).toHaveBeenCalledWith('work-thread', 'old-turn')
    expect(f.sendMessage).toHaveBeenCalledWith('edited'); expect(track).not.toHaveBeenCalled()
  })
  it('creates a fresh tracked user submission after rewind without copying the old task identity', async () => {
    setProductCapture(true, epoch)
    const f = fixture(); await f.actions.rewindAndResend('user-1', 'edited private prompt')
    expect(f.sendMessage.mock.calls[0]?.[2]?.clientRequestId).toMatch(new RegExp(`^turn_work_${epoch}_`))
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2))
    expect(track.mock.calls.map(([e]) => (e as { name: string }).name)).toEqual(['work_task_submitted', 'work_submission_finished'])
    expect(JSON.stringify(track.mock.calls)).not.toContain('edited private prompt')
  })
  it('never assigns an earlier click to a new account after asynchronous rewind', async () => {
    setProductCapture(true, epoch)
    const f = fixture()
    f.rewindThread.mockImplementation(async () => { setProductCapture(true, 'bf5bcf48-b546-4b2e-bab1-154f8fa31f56') })
    await f.actions.rewindAndResend('user-1', 'edited')
    expect(f.sendMessage).toHaveBeenCalledWith('edited'); expect(track).not.toHaveBeenCalled()
  })
})
