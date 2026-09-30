// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'

const fixture = vi.hoisted(() => ({
  chat: {
    composerHarnessId: 'claude-code', composerCredentialMode: 'native-login', composerProviderId: '', composerModel: '',
    composerModelGroups: [{ providerId: 'kun-provider', label: 'Kun provider', modelIds: ['deepseek-chat'] }],
    composerIsolation: 'local', adeDraftOpen: false, activeThreadId: null as string | null,
    setComposerHarness: vi.fn(), setComposerModel: vi.fn(), setComposerIsolation: vi.fn(),
    setComposerExecutionSettings: vi.fn(), requestAdeThreadWorkspace: vi.fn()
  },
  harnesses: {
    rows: [] as AdeHarnessRow[], rowsLoading: true,
    models: {} as Record<string, { models: string[]; loading: boolean }>, providerGroups: {}, sessions: {}
  }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (state: typeof fixture.chat) => unknown) => selector(fixture.chat), {
    getState: () => fixture.chat
  })
}))
vi.mock('../../store/harness-store', () => ({
  useHarnessStore: Object.assign((selector: (state: typeof fixture.harnesses) => unknown) => selector(fixture.harnesses), {
    getState: () => fixture.harnesses
  }),
  harnessRowRunsTurns: () => true, harnessRowUnavailableCode: () => null, harnessModelFingerprint: () => '',
  loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn(), loadHarnesses: vi.fn()
}))
vi.mock('../../store/task-workspace-store', () => ({ useTaskWorkspaceStore: () => undefined }))
vi.mock('../../history-reference/use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => false }))
vi.mock('../../lib/harness-defaults', () => ({ useHarnessDefaults: () => ({}), harnessPermissionDefault: () => undefined }))
vi.mock('./use-ade-worktree-git', () => ({ useAdeWorktreeGit: () => ({ status: 'not-git' }) }))
vi.mock('./use-code-project-defaults', () => ({ useCodeProjectDefaults: () => undefined }))
import { useAdeComposerControls } from './use-ade-composer-controls'

beforeEach(() => {
  fixture.chat.composerHarnessId = 'claude-code'
  fixture.chat.composerCredentialMode = 'native-login'
  fixture.chat.composerProviderId = ''
  fixture.chat.composerModel = ''
  fixture.chat.activeThreadId = null
  fixture.chat.composerModelGroups = [{ providerId: 'kun-provider', label: 'Kun provider', modelIds: ['deepseek-chat'] }]
  fixture.harnesses.rows = []
  fixture.harnesses.models = {}
  fixture.chat.setComposerHarness.mockReset().mockImplementation((id: string, credential: string) => {
    fixture.chat.composerHarnessId = id
    fixture.chat.composerCredentialMode = credential
  })
  fixture.chat.setComposerModel.mockReset().mockImplementation((model: string, providerId: string) => {
    fixture.chat.composerModel = model
    fixture.chat.composerProviderId = providerId
  })
})

describe('external Agent model discovery', () => {
  it('never exposes the Kun model catalog while an external Agent row is missing', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let result!: ReturnType<typeof useAdeComposerControls>
    function Probe() {
      result = useAdeComposerControls({ enabled: true, activeThreadId: null, workspaceRoot: '/repo',
        threadHarnessId: undefined, threadTaskWorkspaceId: undefined, threadHasUserMessages: false,
        hasConfiguredProvider: true })
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(Probe)))
      expect(result.modelGroups).toEqual([])
      expect(result.pickList).toEqual([])
      fixture.harnesses.rows = [{ definition: { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
        credentialModes: ['native-login'], permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
        status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', checkedAt: '' } }]
      fixture.harnesses.models = { 'claude-code': { models: ['sonnet'], loading: false } }
      await act(async () => root.render(createElement(Probe)))
      expect(result.modelGroups).toEqual([{ providerId: 'ade-cred:native-login', label: 'adeCredential.nativeLogin', modelIds: ['sonnet'] }])
      expect(result.pickList).toEqual(['sonnet'])
      fixture.chat.composerHarnessId = 'kun'
      await act(async () => root.render(createElement(Probe)))
      expect(result.modelGroups).toBeNull()
      expect(result.pickList).toBeNull()
    } finally {
      await act(async () => root.unmount())
      ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    }
  })

  it('restores the last valid Kun source/model within the same draft and forgets it in another thread', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    fixture.chat.composerHarnessId = 'kun'
    fixture.chat.composerProviderId = 'provider-b'
    fixture.chat.composerModel = 'model-b-2'
    fixture.chat.composerModelGroups = [
      { providerId: 'provider-a', label: 'A', modelIds: ['model-a'] },
      { providerId: 'provider-b', label: 'B', modelIds: ['model-b', 'model-b-2'] }
    ]
    fixture.harnesses.rows = [{ definition: { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
      credentialModes: ['native-login'], permissionModes: [], modelSource: 'static', staticModels: ['sonnet'], builtin: true },
      status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', checkedAt: '' } }]
    let result!: ReturnType<typeof useAdeComposerControls>
    function Probe() {
      result = useAdeComposerControls({ enabled: true, activeThreadId: fixture.chat.activeThreadId, workspaceRoot: '/repo',
        threadHarnessId: undefined, threadTaskWorkspaceId: undefined, threadHasUserMessages: false,
        hasConfiguredProvider: true })
      return null
    }
    const root = createRoot(document.createElement('div'))
    const render = async () => { await act(async () => root.render(createElement(Probe))) }
    try {
      await render()
      await act(async () => result.selectHarness('claude-code'))
      expect(fixture.chat.composerProviderId).toBe('')
      expect(fixture.chat.composerModel).toBe('sonnet')
      await render()
      await act(async () => result.selectHarness('kun'))
      expect(fixture.chat.composerProviderId).toBe('provider-b')
      expect(fixture.chat.composerModel).toBe('model-b-2')
      await render()
      await act(async () => result.selectHarness('claude-code'))
      await render()
      fixture.chat.activeThreadId = 'another-thread'
      await render()
      await act(async () => result.selectHarness('kun'))
      expect(fixture.chat.composerProviderId).toBe('')
      expect(fixture.chat.composerModel).toBe('')
    } finally {
      await act(async () => root.unmount())
      ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    }
  })

  it('does not restore a removed Kun model after returning from an external Agent', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    fixture.chat.composerHarnessId = 'kun'
    fixture.chat.composerProviderId = 'kun-provider'
    fixture.chat.composerModel = 'deepseek-chat'
    let result!: ReturnType<typeof useAdeComposerControls>
    function Probe() {
      result = useAdeComposerControls({ enabled: true, activeThreadId: null, workspaceRoot: '/repo',
        threadHarnessId: undefined, threadTaskWorkspaceId: undefined, threadHasUserMessages: false,
        hasConfiguredProvider: true })
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(createElement(Probe)))
      await act(async () => result.selectHarness('claude-code', 'native-login'))
      fixture.chat.composerModelGroups = [{ providerId: 'kun-provider', label: 'Kun provider', modelIds: ['replacement'] }]
      await act(async () => root.render(createElement(Probe)))
      await act(async () => result.selectHarness('kun'))
      expect(fixture.chat.composerModel).toBe('replacement')
    } finally {
      await act(async () => root.unmount())
      ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})
