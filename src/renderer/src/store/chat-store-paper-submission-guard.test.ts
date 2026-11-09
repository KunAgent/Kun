import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { createAdmissionHarness } from './chat-store-admission-test-support'

const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))

beforeEach(() => rendererRuntimeClient.invalidateSettings())
afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture() {
  const sendUserMessage = vi.fn(async () => ({ threadId: 'thr_existing', turnId: 'turn_paper', userMessageItemId: 'user_paper' }))
  registry.getProvider.mockReturnValue({ connect: vi.fn(async () => undefined), sendUserMessage, subscribeThreadEvents: vi.fn(async () => undefined) })
  const { actions, state } = createAdmissionHarness()
  state.route = 'papers'
  state.busy = false
  state.error = null
  state.threads[0].agentSurface = 'write'
  const settings = {
    agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
    workspaceRoot: '/workspace/deepseek-gui', codePromptPrefix: '', chatWelcomeMessage: ''
  }
  const getSettings = vi.fn(async () => settings)
  vi.stubGlobal('window', { kunGui: { getSettings,
    workspaceDirectoryExists: vi.fn(async () => true), logError: vi.fn(async () => undefined) } })
  return { actions, state, sendUserMessage, getSettings, settings }
}

describe('source-scoped submission fence at real admission', () => {
  it('stops a paper request after settings await when the reader changes but the thread does not', async () => {
    const f = fixture()
    let source = 'paper-a'
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    f.getSettings.mockImplementation(async () => { await gate; return f.settings })
    const sending = f.actions.sendMessage('Explain A', 'agent', {
      expectedThreadId: 'thr_existing', agentSurface: 'write',
      submissionGuard: () => source === 'paper-a', attachments: [], attachmentIds: [], fileReferences: [], composerContexts: []
    })
    await vi.waitFor(() => expect(f.getSettings).toHaveBeenCalled())
    source = 'paper-b'
    expect(f.state.activeThreadId).toBe('thr_existing')
    release()
    await expect(sending).resolves.toBe(false)
    expect(f.sendUserMessage).not.toHaveBeenCalled()
    expect(f.state.blocks.filter((block) => block.kind === 'user')).toEqual([])
    expect(f.state.busy).toBe(false)
  })

  it('sends a Work-surface turn normally when the source fence remains valid', async () => {
    const f = fixture()
    await expect(f.actions.sendMessage('Explain A', 'agent', {
      expectedThreadId: 'thr_existing', agentSurface: 'write', submissionGuard: () => true,
      attachments: [], attachmentIds: [], fileReferences: [], composerContexts: []
    })).resolves.toBe(true)
    expect(f.sendUserMessage).toHaveBeenCalledOnce()
    expect(f.sendUserMessage).toHaveBeenCalledWith('thr_existing', expect.any(String), expect.objectContaining({ agentSurface: 'write' }))
    expect(f.state.route).toBe('papers')
  })
})
