import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer } from 'react-test-renderer'
import {
  FloatingComposer,
  buildResearchPrompt,
  calculateComposerMenuScrollTop,
  calculateContextCapacityPopoverPlacement,
  formatGoalElapsedSeconds,
  handleComposerImagePaste,
  imageFilesFromTransfer,
  imageTransferHasImages,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseResearchCommand,
  parseReviewCommand,
  returnQueuedMessageToComposer,
  shouldCaptureFileMentionCommitKey,
  shouldShowVoiceDictation,
  shouldShowGoalFloater,
  shouldShowUsageHistory,
  shouldShowWorkspaceControls,
  shouldSurfaceComposerUserInput
} from './FloatingComposer'
import { COMPOSER_INPUT_HISTORY_STORAGE_KEY } from './use-composer-input-history'
import {
  FloatingComposerModelPicker,
  buildComposerModelMenuGroups,
  calculateFloatingReasoningPopoverPlacement,
  calculateFloatingMenuPlacement,
  calculateFloatingSubmenuPlacement,
  composerReasoningEffortForRailKey,
  composerReasoningEffortHasEnergyMotion,
  composerReasoningEffortForRailPosition,
  composerReasoningRailPointerPosition,
  composerReasoningRailPosition,
  composerModelMenuItemSelected,
  composerMenuSupportsModel,
  composerReasoningEffortRequestValue,
  buildComposerModelOptions,
  filterComposerModelIds,
  normalizeComposerReasoningEffort,
  orderComposerReasoningRailEfforts
} from './FloatingComposerModelPicker'
import {
  FloatingComposerExecutionPicker,
  FloatingComposerPermissionMenuContent,
  calculateExecutionMenuPlacement
} from './FloatingComposerExecutionPicker'
import {
  FloatingComposerQueuedMessages,
  calculateQueuedMessageMenuPlacement,
  canEditQueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import { FloatingComposerAboveInputStack } from './FloatingComposerAboveInputStack'
import { requestContextSnapshotMatchesSelection } from './FloatingComposerContextCapacity'
import { getGoalPanelDraftObjective } from './floating-composer-commands'
import { useChatStore } from '../../store/chat-store'
import { useGraphStore } from '../../graph/graph-store'
import i18n from '../../i18n'
import {
  buildComposerFileContextPrompt,
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isFileWithinDirectory,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { filesUnderDirectory } from '../../lib/workspace-file-index'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

const DEEPSEEK_PROVIDER_GROUP = {
  providerId: 'deepseek',
  label: 'DeepSeek',
  modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash']
}

const CODEX_PROVIDER_GROUP: ModelProviderModelGroup = {
  providerId: 'codex-2',
  presetSource: 'codex',
  label: 'ChatGPT subscription 2',
  modelIds: ['gpt-5.4', 'gpt-5.4-mini'],
  modelProfiles: {
    'gpt-5.4': {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url'],
      serviceTiers: ['priority']
    },
    'gpt-5.4-mini': {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url']
    }
  }
}

describe('FloatingComposer input history and footer hints', () => {
  class MemoryStorage {
    private values = new Map<string, string>()

    getItem(key: string): string | null {
      return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
      this.values.set(key, value)
    }

    removeItem(key: string): void {
      this.values.delete(key)
    }
  }

  function installHistoryTestGlobals(storage: MemoryStorage): void {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage
    })
    vi.stubGlobal('window', {
      localStorage: storage,
      innerWidth: 1280,
      innerHeight: 800,
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0)
        return 1
      },
      cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      kunGui: undefined
    })
    vi.stubGlobal('document', {
      activeElement: null,
      body: {}
    })
  }

  afterEach(async () => {
    await act(async () => undefined)
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  function baseComposerProps(overrides: Record<string, unknown> = {}) {
    return {
      input: '',
      setInput: () => undefined,
      mode: 'agent' as const,
      setMode: () => undefined,
      busy: false,
      runtimeReady: true,
      hasActiveThread: true,
      composerModel: '',
      composerPickList: [] as string[],
      onComposerModelChange: () => undefined,
      queuedMessages: [] as [],
      onRemoveQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined,
      attachmentUploadEnabled: false,
      webAccessAvailable: false,
      ...overrides
    }
  }

  it('omits the send shortcut from the footer while keeping newline guidance in the placeholder', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const html = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps()))
      expect(html).not.toContain('ds-composer-footer-hint')
      expect(html).not.toContain('Enter to send · Shift+Enter for newline')
      expect(html).toContain('Ask the agent… (Shift+Enter for newline)')
      expect(html.indexOf('ds-chat-composer')).toBeLessThan(html.indexOf('ds-composer-footer'))
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('keeps the send shortcut out of the footer as the draft changes', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const drafting = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
        input: 'draft prompt'
      })))
      expect(drafting).not.toContain('ds-composer-footer-hint')
      expect(drafting).not.toContain('Enter to send · Shift+Enter for newline')
      expect(drafting).toContain('ds-composer-footer')

      const whitespaceOnly = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
        input: '   '
      })))
      expect(whitespaceOnly).not.toContain('Enter to send · Shift+Enter for newline')

      const cleared = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps()))
      expect(cleared).not.toContain('Enter to send · Shift+Enter for newline')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('omits the reversed send shortcut too', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const html = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
        composerSendKey: 'shiftEnter' as const
      })))
      expect(html).not.toContain('ds-composer-footer-hint')
      expect(html).not.toContain('Shift+Enter to send · Enter for newline')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('keeps high-priority footer hints while input is present', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const offline = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
        input: 'draft prompt',
        runtimeReady: false
      })))
      expect(offline).toContain('ds-composer-footer-hint')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('hard-disables editing and submission for external destructive operations', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
      disabled: true,
      input: 'keep this draft'
    })))

    expect(html).toMatch(/<textarea[^>]*disabled=""/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send"/)
  })

  it('removes the Code/Design selector from a locked conversation', () => {
    const lockedCode = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
      taskSurface: 'code',
      taskSurfaceLocked: true,
      designTaskProfile: { outputMedium: 'html', target: 'web', preset: 'none' }
    })))
    const lockedDesign = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
      taskSurface: 'design',
      taskSurfaceLocked: true,
      designProfileLocked: true,
      designTaskProfile: { outputMedium: 'html', target: 'web', preset: 'none' }
    })))

    expect(lockedCode).not.toContain('data-task-surface-selector')
    expect(lockedCode).not.toContain('ds-composer-task-profile')
    expect(lockedDesign).not.toContain('data-task-surface-selector')
    expect(lockedDesign).toContain('ds-composer-task-profile')
    expect(lockedDesign).toContain('data-task-surface="design"')
  })

  it('moves the persona picker out of the composer toolbar', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposer, baseComposerProps({
      composerPersonaId: 'doubter',
      codeAgentPresets: [{ id: 'doubter' }],
      onComposerPersonaChange: () => undefined
    })))

    expect(html).not.toContain('data-composer-persona="doubter"')
    expect(html).not.toContain('ds-composer-persona-control')
    expect(html).toContain('ds-composer-menu-button')
  })

  it('restores previous sent text with ArrowUp when the caret is on the first line', async () => {
    const storage = new MemoryStorage()
    storage.setItem(COMPOSER_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(['previous prompt']))
    installHistoryTestGlobals(storage)

    const setInput = vi.fn()
    let renderer: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposer, baseComposerProps({
        variant: 'compact',
        input: 'current draft',
        setInput
      })))
    })

    try {
      const textarea = renderer!.root.findByType('textarea')
      const preventDefault = vi.fn()
      await act(async () => {
        textarea.props.onKeyDown({
          key: 'ArrowUp',
          altKey: false,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          nativeEvent: { isComposing: false },
          preventDefault,
          currentTarget: {
            selectionStart: 0,
            focus: vi.fn(),
            setSelectionRange: vi.fn()
          }
        })
      })
      expect(preventDefault).toHaveBeenCalled()
      expect(setInput).toHaveBeenCalledWith('previous prompt')
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })

  it('lets the slash-command menu own ArrowUp instead of input history', async () => {
    const storage = new MemoryStorage()
    storage.setItem(COMPOSER_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(['previous prompt']))
    installHistoryTestGlobals(storage)

    const setInput = vi.fn()
    let renderer: ReturnType<typeof createRenderer>
    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposer, baseComposerProps({
        variant: 'compact',
        input: '/',
        setInput
      })))
    })

    try {
      const textarea = renderer!.root.findByType('textarea')
      await act(async () => {
        textarea.props.onKeyDown({
          key: 'ArrowUp',
          altKey: false,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          nativeEvent: { isComposing: false },
          preventDefault: vi.fn(),
          currentTarget: {
            selectionStart: 1,
            focus: vi.fn(),
            setSelectionRange: vi.fn()
          }
        })
      })
      expect(setInput).not.toHaveBeenCalled()
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })
})
