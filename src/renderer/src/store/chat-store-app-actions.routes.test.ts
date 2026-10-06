import { describe, expect, it, vi } from 'vitest'
import type i18next from 'i18next'
import type { AppRoute, ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'

function buildActions(initial: Partial<ChatState>) {
  const state = { route: 'chat', settingsReturnRoute: 'chat', ...initial } as ChatState
  const set: ChatStoreSet = (partial) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get: ChatStoreGet = () => state
  const noop = (): undefined => undefined
  const actions = createAppActions({
    set,
    get,
    i18n: { t: (key: string) => key, changeLanguage: vi.fn(async () => undefined) } as unknown as typeof i18next,
    persistComposerModel: noop,
    persistComposerMode: noop,
    persistComposerFastMode: noop,
    persistComposerReasoningEffort: noop,
    rememberThreadComposerMode: noop,
    readStoredComposerModel: () => '',
    mergeComposerPickList: () => [],
    fallbackComposerModel: () => '',
    getComposerModelLoadPromise: () => null,
    setComposerModelLoadPromise: noop,
    applyTheme: noop,
    applyUiFontScale: noop,
    applyChatContentMaxWidth: noop,
    applyCursorSpotlight: noop,
    applyCursorSpotlightColor: noop,
    applyDarkUiColors: noop,
    applyWriteTypography: noop,
    applyDocumentLocale: noop,
    workspaceLabelFromPath: (workspaceRoot: string) => workspaceRoot,
    normalizeWorkspaceRoot: (workspaceRoot?: string | null) => workspaceRoot?.trim() ?? ''
  } as unknown as Parameters<typeof createAppActions>[0])
  return { state, actions }
}

describe('retired workspace routes', () => {
  it.each<[AppRoute, AppRoute]>([['rooms', 'agent-chat'], ['design', 'chat'], ['write', 'write'], ['agent-chat', 'agent-chat']])(
    'opens %s as %s',
    (requested, expected) => {
      const { state, actions } = buildActions({})
      actions.setRoute(requested)
      expect(state.route).toBe(expected)
    }
  )

  it('returns from settings to Code conversations instead of the retired Rooms mode', () => {
    const { state, actions } = buildActions({ route: 'rooms' as AppRoute })
    actions.openSettings('general')
    expect(state.settingsReturnRoute).toBe('agent-chat')
    actions.closeSettings()
    expect(state.route).toBe('agent-chat')
  })

  it('maps a persisted Rooms return route when settings close', () => {
    const { state, actions } = buildActions({ route: 'settings', settingsReturnRoute: 'rooms' })
    actions.closeSettings()
    expect(state.route).toBe('agent-chat')
  })
})
