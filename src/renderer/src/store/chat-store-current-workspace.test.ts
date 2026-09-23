// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentCodeWorkspaceRoot } from './chat-store-current-workspace'
import { createAppActions } from './chat-store-app-actions'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

describe('currentCodeWorkspaceRoot', () => {
  it('prefers the store root over the host setting', () => {
    expect(currentCodeWorkspaceRoot(
      { workspaceRoot: '/local/picked' },
      { workspaceRoot: '/host/settings' }
    )).toBe('/local/picked')
  })

  it('falls back to the host setting when the store is empty', () => {
    expect(currentCodeWorkspaceRoot(
      { workspaceRoot: '  ' },
      { workspaceRoot: '/host/settings' }
    )).toBe('/host/settings')
  })

  it('normalizes both candidates before comparing', () => {
    expect(currentCodeWorkspaceRoot(
      { workspaceRoot: '/local/picked/' },
      { workspaceRoot: '/host' }
    )).toBe(normalizeWorkspaceRoot('/local/picked/'))
  })
})

function buildReloadHarness(initial?: Partial<ChatState>): {
  actions: { reloadUiSettings: () => Promise<void> }
  state: ChatState
} {
  const state = {
    workspaceRoot: '/local/picked',
    workspaceRootLocal: true,
    workspaceLabel: 'picked',
    composerOrchestration: 'direct',
    activeClawChannelId: '',
    runtimeConnection: 'idle',
    applyI18nFromSettings: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    loadComposerModels: vi.fn(async () => undefined),
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createAppActions({
    set,
    get,
    i18n: { t: (key: string) => key, changeLanguage: async () => undefined } as never,
    persistComposerModel: vi.fn(),
    persistComposerMode: vi.fn(),
    persistComposerReasoningEffort: vi.fn(),
    persistComposerFastMode: vi.fn(),
    rememberThreadComposerMode: vi.fn(),
    readStoredComposerModel: vi.fn(() => ''),
    mergeComposerPickList: vi.fn(() => []),
    fallbackComposerModel: vi.fn(() => ''),
    getComposerModelLoadPromise: vi.fn(() => null),
    setComposerModelLoadPromise: vi.fn(),
    applyTheme: vi.fn(),
    applyUiFontScale: vi.fn(),
    applyChatContentMaxWidth: vi.fn(),
    applyCursorSpotlight: vi.fn(),
    applyCursorSpotlightColor: vi.fn(),
    applyDarkUiColors: vi.fn(),
    applyWriteTypography: vi.fn(),
    applyDocumentLocale: vi.fn(),
    workspaceLabelFromPath: (root: string) => root.split('/').filter(Boolean).at(-1) ?? '',
    normalizeWorkspaceRoot
  })
  return { actions, state }
}

function hostSettings(workspaceRoot: string): Record<string, unknown> {
  return {
    workspaceRoot,
    conversationWorkspaceRoot: '/conversations',
    theme: 'system',
    uiFontScale: 1,
    chatContentMaxWidthPx: 0,
    cursorSpotlight: false,
    cursorSpotlightColor: '',
    darkUiColors: {},
    write: { typography: {} },
    disabledSkillIds: [],
    codeAgentPresets: [],
    codeAgentPersonaEnabled: true,
    agents: { kun: {} },
    claw: { channels: [] },
    locale: 'en'
  }
}

describe('reloadUiSettings workspace isolation', () => {
  beforeEach(() => {
    window.kunGui = { getSettings: vi.fn() } as never
  })

  it('keeps a renderer-local workspaceRoot instead of snapping back to the host', async () => {
    vi.mocked(window.kunGui.getSettings).mockResolvedValue(hostSettings('/host/project') as never)
    const { actions, state } = buildReloadHarness()
    await actions.reloadUiSettings()
    expect(state.workspaceRoot).toBe('/local/picked')
    expect(state.workspaceLabel).toBe('picked')
  })

  it('adopts the host workspaceRoot when the selection is persisted', async () => {
    vi.mocked(window.kunGui.getSettings).mockResolvedValue(hostSettings('/host/project') as never)
    const { actions, state } = buildReloadHarness({ workspaceRootLocal: false })
    await actions.reloadUiSettings()
    expect(state.workspaceRoot).toBe('/host/project')
  })
})
