import { describe, expect, it, vi } from 'vitest'
import type { AdeProjectDefaultsSnapshot } from '@shared/ade-project-defaults'
import type { AgentProvider } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { captureCodeProjectRouteSnapshot } from '../../store/chat-store-ade-send-snapshot'
import { createNewSendThread } from '../../store/chat-store-thread-send-create'
import type { PreparedThreadSend } from '../../store/chat-store-thread-send-direct-types'
import { codeProjectDefaultsPatch } from './use-code-project-defaults'

const revision = `ade-project-v1:${'a'.repeat(64)}`
const snapshot: AdeProjectDefaultsSnapshot = {
  project: { key: '/repo', sourcePath: '/repo', kind: 'git' },
  revision,
  value: {
    route: { harnessId: 'claude-code', model: 'claude-sonnet', credentialMode: 'native-login' },
    collaborationEnabled: false
  }
}

describe('Code project route projection', () => {
  it('shows the inherited Agent/model and freezes that project revision on first create', async () => {
    const state = {
      ...useChatStore.getState(), workspaceRoot: '/repo', activeThreadId: null,
      composerModel: 'deepseek-chat', composerProviderId: 'deepseek',
      composerHarnessId: 'kun', composerCredentialMode: '',
      composerRouteExplicitWorkspaceRoot: ''
    }
    const patch = codeProjectDefaultsPatch(state, snapshot, '/repo')
    expect(patch).toMatchObject({
      composerModel: 'claude-sonnet', composerProviderId: '',
      composerHarnessId: 'claude-code', composerCredentialMode: 'native-login'
    })
    const frozen = captureCodeProjectRouteSnapshot({ ...state, ...patch })
    expect(frozen).toMatchObject({ routeIntent: 'inherit', projectDefaultsRevision: revision })

    const createThread = vi.fn(async () => ({ id: 'created' }))
    await createNewSendThread({ createThread } as unknown as AgentProvider, {
      generatedTitle: 'Task', composerModel: patch.composerModel,
      composerProviderId: patch.composerProviderId,
      composerHarnessId: patch.composerHarnessId,
      composerCredentialMode: patch.composerCredentialMode,
      codeProjectRoute: frozen,
      requestedAgentSurface: 'code', mode: 'agent'
    } as PreparedThreadSend, '/repo', false)
    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      routeIntent: 'inherit', projectDefaultsRevision: revision,
      harnessId: 'claude-code', model: 'claude-sonnet', credentialMode: 'native-login'
    }))
  })

  it('keeps an earlier user pick and sends it as explicit under the displayed revision', () => {
    const state = {
      ...useChatStore.getState(), workspaceRoot: '/repo', activeThreadId: null,
      composerModel: 'my-model', composerProviderId: 'my-provider',
      composerHarnessId: 'kun', composerCredentialMode: '',
      composerRouteExplicitWorkspaceRoot: '/repo'
    }
    const patch = codeProjectDefaultsPatch(state, snapshot, '/repo')
    expect(patch.composerModel).toBeUndefined()
    expect(patch.composerHarnessId).toBeUndefined()
    expect(captureCodeProjectRouteSnapshot({ ...state, ...patch })).toMatchObject({
      routeIntent: 'explicit', projectDefaultsRevision: revision
    })
  })

  it('does not apply a late project response to a different selected workspace', () => {
    const state = { ...useChatStore.getState(), workspaceRoot: '/other', activeThreadId: null }
    expect(codeProjectDefaultsPatch(state, snapshot, '/repo')).toEqual({})
    expect(captureCodeProjectRouteSnapshot({ ...state,
      composerProjectDefaults: { workspaceRoot: '/repo', revision, value: snapshot.value }
    })).toBeUndefined()
  })
})
