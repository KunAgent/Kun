import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { applySavedTaskRoute, captureTaskComposerSelection } from './task-settings-composer'
import type { AdeTaskSettingsResponse } from '@shared/ade-task-settings'
const saved = { current: { route: { harnessId: 'kun', model: 'old', providerId: 'http' } },
  pending: { route: { harnessId: 'codex', model: 'new', credentialMode: 'native-login' } } } as AdeTaskSettingsResponse
beforeEach(() => useChatStore.setState({ activeThreadId: 'task', composerHarnessId: 'kun', composerCredentialMode: '',
  composerProviderId: 'http', composerModel: 'old', setComposerHarness: vi.fn(), setComposerModel: vi.fn(),
  queuedMessages: [{ id: 'queued', text: 'already accepted', model: 'old' }] as never }))
describe('saved task route projection', () => {
  it('projects the pending route and leaves admitted queue snapshots untouched', () => {
    const before = captureTaskComposerSelection()
    const queued = useChatStore.getState().queuedMessages
    applySavedTaskRoute('task', before, saved)
    expect(useChatStore.getState().setComposerHarness).toHaveBeenCalledWith('codex', 'native-login')
    expect(useChatStore.getState().setComposerModel).toHaveBeenCalledWith('new', '')
    expect(useChatStore.getState().queuedMessages).toBe(queued)
  })
  it.each([{ activeThreadId: 'worker' }, { composerModel: 'newer manual choice' }, { composerProviderId: 'another' }])('does not overwrite navigation or a later manual selection: %j', (patch) => {
    const before = captureTaskComposerSelection()
    useChatStore.setState(patch)
    applySavedTaskRoute('task', before, saved)
    expect(useChatStore.getState().setComposerModel).not.toHaveBeenCalled()
    expect(useChatStore.getState().setComposerHarness).not.toHaveBeenCalled()
  })
})
