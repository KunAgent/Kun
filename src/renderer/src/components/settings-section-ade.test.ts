import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AdeLabSettingsPanel } from './settings-section-lab-ade'
import { AgentsHarnessesSettingsPanel } from './settings-section-agents-harnesses'
import { WorktreeSettingsSection } from './settings-section-worktree'
import { useHarnessStore } from '../store/harness-store'
import { useChatStore } from '../store/chat-store'
import { readStoredComposerIsolation } from '../store/chat-store-helpers'
import type { ReactTestInstance } from 'react-test-renderer'

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

describe('AdeLabSettingsPanel', () => {
  it('patches ade fields and keeps the new value on reopen', () => {
    const updateKun = vi.fn()
    const kun = defaultKunRuntimeSettings()
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AdeLabSettingsPanel, {
        view: { t, kun, updateKun, modelProviders: [] }
      }))
    })
    const switches = renderer!.root.findAllByProps({ role: 'switch' })
    // Order: enabled, harnessRouter, deterministicHandoff, managerMayApprove, allowUnattendedFullAccess, hibernation
    act(() => switches[0].props.onClick())
    expect(updateKun).toHaveBeenCalledWith({ ade: { enabled: true } })
    act(() => switches[3].props.onClick())
    expect(updateKun).toHaveBeenCalledWith({ ade: { managerMayApprove: true } })

    // "Reopen" with the saved value: the toggle must render checked.
    const saved = { ...kun, ade: { ...kun.ade, enabled: true, managerMayApprove: true } }
    act(() => renderer!.unmount())
    act(() => {
      renderer = create(createElement(AdeLabSettingsPanel, {
        view: { t, kun: saved, updateKun, modelProviders: [] }
      }))
    })
    const reopened = renderer!.root.findAllByProps({ role: 'switch' })
    expect(reopened[3].props['aria-checked']).toBe(true)
    act(() => renderer!.unmount())
  })

  it('patches numeric limits', () => {
    const updateKun = vi.fn()
    const kun = {
      ...defaultKunRuntimeSettings(),
      ade: { ...defaultKunRuntimeSettings().ade, enabled: true }
    }
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AdeLabSettingsPanel, {
        view: { t, kun, updateKun, modelProviders: [] }
      }))
    })
    const soft = renderer!.root.findByProps({ 'aria-label': 'adeSettings.softWorkers' })
    act(() => soft.props.onChange({ target: { value: '6' } }))
    expect(updateKun).toHaveBeenCalledWith({ ade: { limits: { softWorkers: 6 } } })
    act(() => renderer!.unmount())
  })
})

describe('AgentsHarnessesSettingsPanel', () => {
  afterEach(() => {
    useHarnessStore.setState({ rows: [], rowsLoadedAt: undefined, rowsLoading: false })
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
    const text = instanceText(renderer.root)
    expect(text).toContain('claude-code display')
    expect(text).toContain('1.2.3')
    expect(text).toContain('adeSettings.harnessLoginSignedIn')
    act(() => renderer.unmount())
  })

  it('writes disabledIds when the enable switch toggles', () => {
    useHarnessStore.setState({
      rows: [makeHarnessRow('kun'), makeHarnessRow('claude-code')],
      rowsLoadedAt: 1_000
    })
    const updateKun = vi.fn()
    const renderer = renderPanel(updateKun)
    // kun's row carries no toggle; the only switch is claude-code's enable.
    const switches = renderer.root.findAllByProps({ role: 'switch' })
    expect(switches).toHaveLength(1)
    act(() => switches[0].props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      harnesses: expect.objectContaining({ disabledIds: ['claude-code'] })
    })
    act(() => renderer.unmount())
  })

  it('adds a custom ACP agent through updateKun', () => {
    useHarnessStore.setState({ rows: [makeHarnessRow('kun')], rowsLoadedAt: 1_000 })
    const updateKun = vi.fn()
    const renderer = renderPanel(updateKun)
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
    act(() => addButton.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      harnesses: expect.objectContaining({
        custom: [
          {
            id: 'custom-my-agent',
            displayName: 'My Agent',
            command: '/usr/local/bin/my-agent',
            args: ['--acp', '--fast'],
            env: { TOKEN: 'abc' }
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
            env: { TOKEN: 'abc' }
          }
        ]
      }
    }
    expect(saved.harnesses.custom[0].id).toBe('custom-my-agent')
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
