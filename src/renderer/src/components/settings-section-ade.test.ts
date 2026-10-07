import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import type {
  AdeCollaborationSettingsMutation,
  AdeCollaborationSettingsMutationResult
} from '@shared/ade-collaboration-settings'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AgentsCollaborationSettingsPanel, collaborationApplyLabelKey } from './settings-section-agents-collaboration'
import { AgentsHarnessesSettingsPanel } from './settings-section-agents-harnesses'
import { WorktreeSettingsSection } from './settings-section-worktree'
import { useHarnessStore } from '../store/harness-store'
import { useChatStore } from '../store/chat-store'
import { readStoredComposerIsolation } from '../store/chat-store-helpers'
import type { ReactTestInstance } from 'react-test-renderer'

const provider = vi.hoisted(() => ({
  probeHarnessDefinition: vi.fn()
}))

vi.mock('../agent/registry', () => ({ getProvider: () => provider }))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  provider.probeHarnessDefinition.mockReset().mockResolvedValue({
    durationMs: 1, ok: true, supported: true, protocol: 'acp'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${JSON.stringify(options)})` : key

// AgentsHarnessesSettingsPanel resolves ADE labels via its own
// useTranslation(['common','settings']); keep the echo-key stub.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const echo = (key: string, options?: Record<string, unknown>): string =>
    options ? `${key}(${JSON.stringify(options)})` : key
  return { ...actual, useTranslation: () => ({ t: echo }) }
})

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === 'string' ? child : instanceText(child)))
    .join('')
}

function makeHarnessRow(id: string, builtin = true): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName: `${id} display`,
      transport: builtin ? 'agent-sdk' : 'acp',
      credentialModes: ['native-login', 'provider'],
      permissionModes: [
        { id: 'default', label: 'Default', kunPermissionMode: 'ask' },
        { id: 'full', label: 'Full', kunPermissionMode: 'full' }
      ],
      modelSource: 'probe',
      staticModels: [],
      builtin
    },
    status: {
      harnessId: id,
      installed: 'yes',
      version: '1.2.3',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00.000Z'
    }
  }
}

describe('AgentsCollaborationSettingsPanel', () => {
  const revision = `ade-collaboration-v1:${'a'.repeat(64)}`
  const savedRevision = `ade-collaboration-v1:${'b'.repeat(64)}`
  it('ignores an older Runtime receipt and does not claim a newer generation is this save', () => {
    const status = { state: 'synced' as const, at: '2026-09-30T00:00:00Z' }
    expect(collaborationApplyLabelKey(4, { ...status, generation: 3 }))
      .toBe('adeSettings.collaborationApply_syncing')
    expect(collaborationApplyLabelKey(4, { ...status, generation: 4 }))
      .toBe('adeSettings.collaborationApply_synced')
    expect(collaborationApplyLabelKey(4, { ...status, generation: 5 }))
      .toBe('adeSettings.collaborationApply_superseded')
  })
  async function renderPanel(saveRequest: (request: AdeCollaborationSettingsMutation) => Promise<AdeCollaborationSettingsMutationResult>) {
    const kun = {
      ...defaultKunRuntimeSettings(),
      ade: { ...defaultKunRuntimeSettings().ade, enabled: true }
    }
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentsCollaborationSettingsPanel, {
        view: {
          t, kun, modelProviders: [], activePanel: 'collaboration',
          load: async () => ({ value: kun.ade, revision }),
          save: saveRequest
        }
      }))
    })
    return renderer!
  }

  async function click(renderer: ReactTestRenderer, label: string): Promise<void> {
    const button = renderer.root.findAllByType('button' as never)
      .find((candidate) => instanceText(candidate).includes(label))!
    await act(async () => button.props.onClick())
  }

  it('keeps partially edited numbers local and saves a valid pair together', async () => {
    const saveRequest = vi.fn(async (request: AdeCollaborationSettingsMutation) => ({
      ok: true as const, value: request.value, revision: savedRevision, generation: 4
    }))
    const renderer = await renderPanel(saveRequest)
    const soft = renderer.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' })
    const hard = renderer.root.findByProps({ 'aria-label': 'adeSettings.hardWorkers' })
    act(() => soft.props.onChange({ target: { value: '' } }))
    expect(saveRequest).not.toHaveBeenCalled()
    await click(renderer, 'adeSettings.collaborationSave')
    expect(saveRequest).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    act(() => {
      soft.props.onChange({ target: { value: '6' } })
      hard.props.onChange({ target: { value: '8' } })
    })
    await click(renderer, 'adeSettings.collaborationSave')
    expect(saveRequest).toHaveBeenCalledWith({
      expectedRevision: revision,
      value: expect.objectContaining({ limits: { softWorkers: 6, hardWorkers: 8 } })
    })
    act(() => renderer.unmount())
  })

  it('saves the routing rollback switches with the collaboration object', async () => {
    const saveRequest = vi.fn(async (request: AdeCollaborationSettingsMutation) => ({
      ok: true as const, value: request.value, revision: savedRevision, generation: 5
    }))
    const renderer = await renderPanel(saveRequest)
    const router = renderer.root.findByProps({ role: 'switch', 'aria-label': 'adeSettings.harnessRouter' })
    expect(router.props['aria-checked']).toBe(true)
    act(() => router.props.onClick())
    await click(renderer, 'adeSettings.collaborationSave')
    expect(saveRequest).toHaveBeenCalledWith({
      expectedRevision: revision,
      value: expect.objectContaining({ harnessRouter: false, deterministicHandoff: true })
    })
    act(() => renderer.unmount())
  })

  it('does not persist an incomplete manager route', async () => {
    const saveRequest = vi.fn()
    const renderer = await renderPanel(saveRequest)
    const source = renderer.root.findByProps({ 'aria-label': 'adeSettings.managerModel' })
    act(() => source.props.onChange({ target: { value: 'missing-provider' } }))
    await click(renderer, 'adeSettings.collaborationSave')
    expect(saveRequest).not.toHaveBeenCalled()
    await click(renderer, 'adeSettings.collaborationDiscard')
    act(() => renderer.unmount())
  })

  it('restores an unsaved draft after visiting another settings category', async () => {
    const saveRequest = vi.fn()
    let renderer = await renderPanel(saveRequest)
    const soft = renderer.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' })
    act(() => soft.props.onChange({ target: { value: '5' } }))
    act(() => renderer.unmount())
    renderer = await renderPanel(saveRequest)
    expect(renderer.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' }).props.value).toBe('5')
    expect(saveRequest).not.toHaveBeenCalled()
    await click(renderer, 'adeSettings.collaborationDiscard')
    act(() => renderer.unmount())
  })

  it('keeps the draft on a concurrent edit and requires an explicit rebase', async () => {
    const baseValue = defaultKunRuntimeSettings().ade
    const saveRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: false, kind: 'conflict', value: { ...baseValue, enabled: true }, revision: savedRevision
      })
      .mockImplementationOnce(async (request: AdeCollaborationSettingsMutation) => ({
        ok: true, value: request.value, revision: `ade-collaboration-v1:${'c'.repeat(64)}`, generation: 5
      }))
    const renderer = await renderPanel(saveRequest)
    act(() => renderer.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' }).props
      .onChange({ target: { value: '5' } }))
    await click(renderer, 'adeSettings.collaborationSave')
    expect(renderer.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' }).props.value).toBe('5')
    expect(renderer.root.findAllByProps({ role: 'alert' })).not.toHaveLength(0)
    await click(renderer, 'adeSettings.collaborationReviewMine')
    await click(renderer, 'adeSettings.collaborationSave')
    expect(saveRequest).toHaveBeenLastCalledWith({
      expectedRevision: savedRevision,
      value: expect.objectContaining({ limits: { softWorkers: 5, hardWorkers: 8 } })
    })
    act(() => renderer.unmount())
  })
})

describe('AgentsHarnessesSettingsPanel', () => {
  afterEach(() => {
    useHarnessStore.setState({ rows: [], rowsLoadedAt: undefined, rowsLoading: false, settingsHarnessId: undefined })
  })

  function renderPanel(updateKun: ReturnType<typeof vi.fn>, kun = defaultKunRuntimeSettings()) {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AgentsHarnessesSettingsPanel, {
        view: { t, kun, updateKun, activePanel: 'harnesses' }
      }))
    })
    return renderer
  }

  it('lists harness rows with version and login state', () => {
    useHarnessStore.setState({
      rows: [makeHarnessRow('kun'), makeHarnessRow('claude-code')],
      rowsLoadedAt: 1_000
    })
    const renderer = renderPanel(vi.fn())
    const claudeListItem = renderer.root.findByProps({ 'data-agent-list-id': 'claude-code' })
    act(() => claudeListItem.props.onClick())
    const text = instanceText(renderer.root)
    expect(text).toContain('claude-code display')
    expect(text).toContain('1.2.3')
    expect(text).toContain('agentEnablement.disabled')
    expect(renderer.root.findAllByProps({ 'data-agent-card': 'claude-code' })).toHaveLength(1)
    const kunListItem = renderer.root.findAllByType('button' as never)
      .find((button) => instanceText(button).includes('kun display'))!
    act(() => kunListItem.props.onClick())
    expect(kunListItem.props['aria-selected']).toBe(true)
    expect(kunListItem.props['data-selected']).toBe(true)
    expect(renderer.root.findAllByProps({ 'data-agent-card': 'claude-code' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-agent-card': 'kun' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('opens the requested Agent detail from a repair deep link', () => {
    useHarnessStore.setState({
      rows: [makeHarnessRow('kun'), makeHarnessRow('claude-code')],
      rowsLoadedAt: 1_000,
      settingsHarnessId: 'kun'
    })
    const renderer = renderPanel(vi.fn())
    expect(renderer.root.findAllByProps({ 'data-agent-card': 'kun' })).toHaveLength(1)
    expect(useHarnessStore.getState().settingsHarnessId).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('shows the selected Agent defaults immediately while keeping command override advanced', () => {
    useHarnessStore.setState({ rows: [makeHarnessRow('kun'), makeHarnessRow('claude-code')], rowsLoadedAt: 1_000 })
    const renderer = renderPanel(vi.fn())
    expect(renderer.root.findAllByProps({ 'data-agent-detail-settings': true })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-agent-advanced-settings': true })).toHaveLength(0)
    const advanced = renderer.root.findAllByType('button' as never)
      .find((button) => button.props['aria-label'] === 'adeAgentAction.specifyPath')!
    act(() => advanced.props.onClick())
    expect(renderer.root.findAllByProps({ 'data-agent-advanced-settings': true })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('removes only the selected profile when explicitly disabled', () => {
    useHarnessStore.setState({
      rows: [makeHarnessRow('kun'), makeHarnessRow('claude-code')],
      rowsLoadedAt: 1_000
    })
    const updateKun = vi.fn()
    const kun = defaultKunRuntimeSettings()
    kun.harnesses.enabledProfiles = [{ harnessId: 'claude-code', credentialMode: 'native-login' }]
    const renderer = renderPanel(updateKun, kun)
    act(() => renderer.root.findByProps({ 'data-agent-list-id': 'claude-code' }).props.onClick())
    const disable = renderer.root.findByProps({ 'data-agent-enable': true })
    act(() => disable.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      harnesses: expect.objectContaining({ enabledProfiles: [] })
    })
    act(() => renderer.unmount())
  })

  it('adds a probed custom ACP agent with empty secret bindings through the add wizard and updateKun', async () => {
    useHarnessStore.setState({ rows: [makeHarnessRow('kun')], rowsLoadedAt: 1_000 })
    const updateKun = vi.fn()
    const renderer = renderPanel(updateKun)
    await act(async () => renderer.root.findByProps({ 'data-agent-add-open': true }).props.onClick())
    await act(async () => renderer.root.findByProps({ 'data-agent-add-custom': true }).props.onClick())
    const inputs = renderer.root.findAllByType('input' as never)
    const textarea = renderer.root.findByType('textarea' as never)
    act(() => {
      inputs.find((i) => i.props.placeholder === 'adeSettings.acpFormName')!.props
        .onChange({ target: { value: 'My Agent' } })
      inputs.find((i) => i.props.placeholder === 'adeSettings.acpFormCommand')!.props
        .onChange({ target: { value: '/usr/local/bin/my-agent' } })
      inputs.find((i) => i.props.placeholder === 'adeSettings.acpFormArgs')!.props
        .onChange({ target: { value: '--acp --fast' } })
      textarea.props.onChange({ target: { value: 'TOKEN=abc' } })
    })
    const addButton = renderer.root
      .findAllByType('button' as never)
      .find((b) => instanceText(b).includes('adeSettings.acpFormAdd'))!
    expect(addButton.props.disabled).toBe(true)
    expect(updateKun).not.toHaveBeenCalled()
    const testButton = renderer.root
      .findAllByType('button' as never)
      .find((b) => instanceText(b).includes('adeSettings.acpFormTest'))!
    await act(async () => testButton.props.onClick())
    expect(provider.probeHarnessDefinition).toHaveBeenCalledWith({
      id: 'custom-my-agent',
      displayName: 'My Agent',
      command: '/usr/local/bin/my-agent',
      args: ['--acp', '--fast'],
      env: { TOKEN: 'abc' },
      secretEnv: []
    }, { signal: expect.any(AbortSignal) })
    expect(addButton.props.disabled).toBe(false)
    await act(async () => addButton.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      harnesses: expect.objectContaining({
        custom: [
          {
            id: 'custom-my-agent',
            displayName: 'My Agent',
            command: '/usr/local/bin/my-agent',
            args: ['--acp', '--fast'],
            env: { TOKEN: 'abc' },
            secretEnv: []
          }
        ]
      })
    })
    // Reopen: the saved custom entry still feeds the form state.
    const saved = {
      ...defaultKunRuntimeSettings(),
      harnesses: {
        ...defaultKunRuntimeSettings().harnesses,
        custom: [
          {
            id: 'custom-my-agent',
            displayName: 'My Agent',
            command: '/usr/local/bin/my-agent',
            args: ['--acp', '--fast'],
            env: { TOKEN: 'abc' },
            secretEnv: []
          }
        ]
      }
    }
    expect(saved.harnesses.custom[0].id).toBe('custom-my-agent')
    expect(renderer.root.findAllByProps({ 'data-agent-add-finish': true })).toHaveLength(1)
    act(() => renderer.unmount())
  })
})

describe('WorktreeSettingsSection ADE additions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderSection(updateKun: ReturnType<typeof vi.fn>, kunPatch: Record<string, unknown> = {}) {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k)
    })
    vi.stubGlobal('window', {
      kunGui: {
        listGitBranchWorktrees: vi.fn(async () => ({
          ok: true,
          worktreeRoot: '/managed',
          mainBranch: 'main',
          worktrees: []
        }))
      }
    })
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(WorktreeSettingsSection, {
        ctx: {
          t,
          form: { workspaceRoot: '/repo', gitBranchPrefix: 'codex/' },
          kun: { ...defaultKunRuntimeSettings(), ...kunPatch },
          update: vi.fn(),
          updateKun,
          threads: [],
          locale: 'en'
        }
      }))
    })
    return renderer
  }

  it('writes the default isolation through the composer store', async () => {
    const renderer = renderSection(vi.fn())
    const select = renderer.root
      .findAllByType('select' as never)
      .find((s) => s.props.value === 'local' || s.props.value === 'worktree')!
    await act(async () => {
      select.props.onChange({ target: { value: 'worktree' } })
    })
    expect(useChatStore.getState().composerIsolation).toBe('worktree')
    expect(readStoredComposerIsolation()).toBe('worktree')
    await act(async () => {
      select.props.onChange({ target: { value: 'local' } })
    })
    expect(readStoredComposerIsolation()).toBe('local')
    act(() => renderer.unmount())
  })

  it('adds and removes shared paths under the project key', async () => {
    const updateKun = vi.fn()
    const renderer = renderSection(updateKun)
    const pathInput = renderer.root
      .findAllByType('input' as never)
      .find((i) => i.props.placeholder === 'adeSettings.sharedPathPlaceholder')!
    act(() => pathInput.props.onChange({ target: { value: '.env.example' } }))
    const addButton = renderer.root
      .findAllByType('button' as never)
      .find((b) => instanceText(b).includes('adeSettings.sharedPathAdd'))!
    await act(async () => addButton.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      worktrees: { sharedPaths: { '/repo': [{ path: '.env.example', mode: 'symlink' }] } }
    })

    // Reopen with the saved value: row shows, remove clears the project key.
    const savedKun = {
      ...defaultKunRuntimeSettings(),
      worktrees: {
        sharedPaths: { '/repo': [{ path: '.env.example', mode: 'symlink' }] }
      }
    }
    act(() => renderer.unmount())
    const reopened = renderSection(updateKun, savedKun)
    const removeButton = reopened.root
      .findAllByProps({ 'aria-label': 'adeSettings.sharedPathRemove' })[0]
    await act(async () => removeButton.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({ worktrees: { sharedPaths: {} } })
    act(() => reopened.unmount())
  })
})
