// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import i18n from '../../i18n'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { FloatingComposerSurfaceView } from './FloatingComposerSurfaceView'

const state = vi.hoisted(() => ({ composerHarnessId: '', setComposerHarness: vi.fn() }))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state })
}))
vi.mock('./FloatingComposerFooterView', () => ({ FloatingComposerFooterView: () => null }))
vi.mock('./KnowledgeBasePicker', () => ({ KnowledgeBasePicker: () => null }))
vi.mock('../../history-reference/CodexReferenceDialog', () => ({ CodexReferenceDialog: () => null }))

const empty = () => null
const externalHarness: AdeHarnessRow = {
  definition: { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
    credentialModes: ['native-login'], permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', checkedAt: '' }
}
const externalProfile = { harnessId: 'claude-code', credentialMode: 'native-login' as const }
let host: HTMLDivElement
let root: Root
let context: FloatingComposerRenderContext
beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  state.composerHarnessId = ''
  state.setComposerHarness.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  context = {
    FileText: empty, FloatingComposerAgentPicker: () => createElement('div', { 'data-kun-persona-picker': true }),
    FloatingComposerAttachments: empty, FloatingComposerContextCapacity: empty,
    FloatingComposerExecutionPicker: empty, FloatingComposerIsolationPicker: empty,
    FloatingComposerModelPicker: ({ composerModelGroups }: { composerModelGroups: ModelProviderModelGroup[] }) =>
      createElement('div', { 'data-test-model-providers': composerModelGroups.map((group) => group.providerId).join(',') }),
    FloatingComposerTaskProfile: () => createElement('div', { 'data-design-task-profile': true }),
    FloatingComposerTaskSurfacePicker: empty,
    Bot: empty, Folder: empty, GitBranchPicker: empty, ListTodo: empty, Loader2: empty,
    Mic: empty, Plus: empty, Send: empty, Share2: empty, Sparkles: empty, Square: empty, Target: empty,
    VoiceRecordingStrip: empty, WorkspaceProjectPicker: empty, X: empty,
    adeComposerEnabled: true, adeComposer: {
      harnessId: 'kun', harnessLabel: 'Kun', rows: [], rowsLoading: false, enabled: true,
      needsSwitchConfirm: () => false, selectHarness: vi.fn(), refreshRows: vi.fn()
    },
    canCompose: true, canEditComposer: true, canOpenComposerMenu: true,
    composerModel: 'deepseek-chat', composerModelGroups: [
      { providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-chat'] },
      { providerId: 'claude-sdk', label: 'Claude Code', kind: 'agent-sdk', modelIds: ['sonnet'] }
    ],
    composerPickList: ['deepseek-chat', 'sonnet'], contextChips: [], attachments: [], fileReferences: [],
    dictation: { status: 'idle' }, draft: { focused: false }, fileMentions: {},
    effectiveWorkspaceRoot: '/repo', input: 'Keep this draft', taskSurface: 'code',
    onTaskSurfaceChange: vi.fn(), onNewRequirement: vi.fn(), designTaskProfile: {},
    showToolbarStartControls: true, showComposerMenuButton: true, showWorkspaceControls: true,
    emptyTaskLayout: true, runtimeReady: true, onComposerModelChange: vi.fn(), t: i18n.getFixedT('en', 'common')
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})
async function render(): Promise<void> {
  await act(async () => root.render(createElement(FloatingComposerSurfaceView, { context })))
}

describe('unified composer Agent control wiring', () => {
  it('pins an unchanged implicit Kun Code selection without resetting its model or mode', async () => {
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-mode-trigger]')!.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-option="kun-code"]')!.click())
    expect(state.setComposerHarness).toHaveBeenCalledWith('kun', '')
    expect(context.adeComposer.selectHarness).not.toHaveBeenCalled()
    expect(context.onTaskSurfaceChange).not.toHaveBeenCalled()
    expect(context.onComposerModelChange).not.toHaveBeenCalled()
  })

  it('pins Kun before changing an implicit Kun draft to Design and removes external SDK model routes', async () => {
    await render()
    expect(host.querySelector('[data-test-model-providers]')?.getAttribute('data-test-model-providers')).toBe('deepseek')
    const trigger = host.querySelector<HTMLButtonElement>('[data-agent-mode-trigger]')!
    await act(async () => trigger.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-option="kun-design"]')!.click())
    expect(context.adeComposer.selectHarness).not.toHaveBeenCalled()
    expect(state.setComposerHarness).toHaveBeenCalledWith('kun', '')
    expect(context.onTaskSurfaceChange).toHaveBeenCalledWith('design')
    expect(state.setComposerHarness.mock.invocationCallOrder[0]).toBeLessThan(context.onTaskSurfaceChange.mock.invocationCallOrder[0])
    expect(host.querySelector('textarea')?.value).toBe('Keep this draft')
  })

  it('selects the external Agent before clearing the Design surface and preserves the draft', async () => {
    context.taskSurface = 'design'
    context.adeComposer.rows = [withHarnessReadiness(externalHarness, [externalProfile])]
    await render()
    expect(host.querySelector('[data-design-task-profile]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-mode-trigger]')!.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-option="claude-code"]')!.click())
    expect(context.adeComposer.selectHarness).toHaveBeenCalledWith('claude-code')
    expect(context.onTaskSurfaceChange).toHaveBeenCalledWith('code')
    expect(context.adeComposer.selectHarness.mock.invocationCallOrder[0]).toBeLessThan(context.onTaskSurfaceChange.mock.invocationCallOrder[0])
    expect(host.querySelector('textarea')?.value).toBe('Keep this draft')
  })

  it.each(['default-disabled', 'expired-proof'])('omits an installed external Agent with %s', async (state) => {
    context.taskSurface = 'design'
    context.adeComposer.rows = [state === 'default-disabled' ? externalHarness : {
      ...withHarnessReadiness(externalHarness, [externalProfile]),
      readyProfiles: [{ ...externalProfile, expiresAt: '2000-01-01T00:00:00Z' }]
    }]
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-mode-trigger]')!.click())
    expect(document.querySelector('[data-agent-mode-option="claude-code"]')).toBeNull()
    expect(context.adeComposer.selectHarness).not.toHaveBeenCalled()
    expect(context.onTaskSurfaceChange).not.toHaveBeenCalled()
    expect(host.querySelector('textarea')?.value).toBe('Keep this draft')
  })

  it('hides Kun design, requirements and persona controls for an external Agent, including stale Design state', async () => {
    context.adeComposer.harnessId = 'claude-code'
    context.adeComposer.harnessLabel = 'Claude Code'
    context.taskSurface = 'design'
    await render()
    expect(host.querySelector('[data-agent-mode-trigger]')?.textContent).toContain('Claude Code')
    expect(host.querySelector('[data-design-task-profile]')).toBeNull()
    expect(host.querySelector('[data-kun-persona-picker]')).toBeNull()
    context.taskSurface = 'code'
    await render()
    expect(host.querySelector('[data-composer-new-requirement]')).toBeNull()
    context.adeComposer.harnessId = 'kun'
    context.adeComposer.harnessLabel = 'Kun'
    await render()
    expect(host.querySelector('[data-composer-new-requirement]')).not.toBeNull()
  })
})
