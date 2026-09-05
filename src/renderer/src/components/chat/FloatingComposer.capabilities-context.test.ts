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
  calculateQueuedMessageMenuPlacement
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

describe('FloatingComposer capability controls', () => {
  it('uses Code intent controls while omitting them from Design', async () => {
    const previousLanguage = i18n.language
    const originalGoalSetter = useChatStore.getState().setActiveThreadGoal
    const setActiveThreadGoal = vi.fn(async () => true)
    const setInput = vi.fn()
    const setMode = vi.fn()
    const onSend = vi.fn()
    let goalRenderer: ReturnType<typeof createRenderer> | undefined
    let planRenderer: ReturnType<typeof createRenderer> | undefined
    let designRenderer: ReturnType<typeof createRenderer> | undefined

    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: [],
      setActiveThreadGoal
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      kunGui: {
        getSettings: vi.fn(async () => ({ composerSendKey: 'enter' }))
      }
    })

    const props = {
      input: 'ship the goal UX',
      setInput,
      mode: 'agent' as const,
      setMode,
      busy: false,
      runtimeReady: true,
      hasActiveThread: false,
      workspaceRootOverride: '/workspace/deepseek-gui',
      composerModel: 'test-model',
      composerPickList: ['test-model'],
      onComposerModelChange: () => undefined,
      queuedMessages: [] as [],
      onRemoveQueuedMessage: () => undefined,
      onSend,
      onInterrupt: () => undefined,
      onPlanCommand: () => undefined,
      attachmentUploadEnabled: false,
      webAccessAvailable: false
    }

    try {
      await act(async () => {
        goalRenderer = createRenderer(createElement(FloatingComposer, props))
      })
      const renderedGoal = goalRenderer!
      const plusButton = renderedGoal.root.findAllByType('button').find(
        (button) => String(button.props.className).includes('ds-composer-menu-button')
      )
      expect(plusButton).toBeDefined()

      await act(async () => {
        plusButton!.props.onClick()
      })
      await act(async () => {
        goalRenderer!.root.findByProps({ 'data-composer-goal-menu-item': true }).props.onClick()
      })

      expect(setMode).toHaveBeenCalledWith('agent')
      expect(renderedGoal.root.findByType('textarea').props.placeholder).toBe('Type a goal for this thread')
      const goalBadge = renderedGoal.root.findByProps({ 'data-composer-goal-mode-badge': true })
      expect(goalBadge.props['aria-label']).toBe('Cancel Goal')

      await act(async () => {
        goalBadge.props.onClick()
      })
      expect(renderedGoal.root.findAllByProps({ 'data-composer-goal-mode-badge': true })).toHaveLength(0)

      await act(async () => {
        plusButton!.props.onClick()
      })
      await act(async () => {
        goalRenderer!.root.findByProps({ 'data-composer-goal-menu-item': true }).props.onClick()
      })
      await act(async () => {
        goalRenderer!.root.findByProps({ 'aria-label': 'Send' }).props.onClick()
      })

      expect(setActiveThreadGoal).toHaveBeenCalledWith('ship the goal UX')
      expect(setInput).toHaveBeenCalledWith('')
      expect(onSend).not.toHaveBeenCalled()
      expect(renderedGoal.root.findAllByProps({ 'data-composer-goal-mode-badge': true })).toHaveLength(0)

      await act(async () => {
        planRenderer = createRenderer(createElement(FloatingComposer, {
          ...props,
          mode: 'plan'
        }))
      })
      const renderedPlan = planRenderer!
      const planBadge = renderedPlan.root.findByProps({ 'data-composer-plan-mode-badge': true })
      expect(planBadge.props['aria-label']).toBe('Cancel Plan')
      await act(async () => {
        planBadge.props.onClick()
      })
      expect(setMode).toHaveBeenLastCalledWith('agent')

      await act(async () => {
        designRenderer = createRenderer(createElement(FloatingComposer, {
          ...props,
          taskSurface: 'design',
          mode: 'plan',
          orchestration: 'graph',
          graphEnabled: true,
          onOrchestrationChange: () => undefined,
          onNewCommand: () => undefined
        }))
      })
      const renderedDesign = designRenderer!
      expect(renderedDesign.root.findAllByProps({ 'data-composer-plan-mode-badge': true })).toHaveLength(0)
      expect(renderedDesign.root.findAllByProps({ 'data-composer-graph-active': true })).toHaveLength(0)
      expect(renderedDesign.root.findAllByProps({ 'data-composer-goal-mode-badge': true })).toHaveLength(0)
      const designPlusButton = renderedDesign.root.findAllByType('button').find(
        (button) => String(button.props.className).includes('ds-composer-menu-button')
      )
      await act(async () => designPlusButton!.props.onClick())
      expect(renderedDesign.root.findAllByProps({ 'data-composer-plan-menu-item': true })).toHaveLength(0)
      expect(renderedDesign.root.findAllByProps({ 'data-composer-graph-menu-item': true })).toHaveLength(0)
      expect(renderedDesign.root.findAllByProps({ 'data-composer-goal-menu-item': true })).toHaveLength(0)
    } finally {
      if (goalRenderer) {
        await act(async () => {
          goalRenderer!.unmount()
        })
      }
      if (planRenderer) {
        await act(async () => {
          planRenderer!.unmount()
        })
      }
      if (designRenderer) {
        await act(async () => {
          designRenderer!.unmount()
        })
      }
      useChatStore.setState({ setActiveThreadGoal: originalGoalSetter })
      await i18n.changeLanguage(previousLanguage)
      vi.unstubAllGlobals()
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    }
  })

  it('renders image attachment thumbnails when a local preview is available', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachments: [{
          id: 'att_1',
          name: 'shot.png',
          mimeType: 'image/png',
          previewUrl: 'blob:shot-preview'
        }],
        attachmentUploadEnabled: true,
        webAccessAvailable: true,
        onRemoveAttachment: () => undefined
      })
    )

    expect(html).toContain('src="blob:shot-preview"')
    expect(html).toContain('alt="shot.png"')
  })

  it('renders @ file reference chips as sendable context', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        fileReferenceEnabled: true,
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx'
        }],
        onRemoveFileReference: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('src/App.tsx')
    expect(html).toContain('Remove reference')
    expect(html).toContain('aria-label="Send"')
    expect(html).not.toContain('aria-label="Send" disabled=""')
  })

  it('renders design context chips without writing them into the textarea', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'Make this more compact',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        contextChips: [{
          id: 'html-screen-frame:s1:login',
          kind: 'html-screen-frame',
          label: 'Login screen',
          detail: '1280 x 800 - .kun-design/login/v1.html',
          removable: true
        }],
        onRemoveContextChip: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('Login screen')
    expect(html).toContain('1280 x 800')
    expect(html).toContain('Remove context')
    expect(html).toContain('>Make this more compact</textarea>')
    expect(html).not.toContain('>Login screen</textarea>')
  })

  it('shows execution access controls beside the composer menu', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui'
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        executionSettings: {
          approvalPolicy: 'auto',
          sandboxMode: 'danger-full-access',
          approvalReviewer: 'user'
        },
        onExecutionSettingsChange: () => undefined
      })
    )

    expect(html).toContain('Tool permission')
    expect(html).toContain('Full access')
    expect(html).not.toContain('Bypass')
    expect(html).not.toContain('>Approval<')
    expect(html).not.toContain('>Access<')
    expect(html).toContain('aria-label="Tool permission"')
  })

  it('keeps historical file-change summaries out of the input', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui'
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'review this',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).not.toContain('files changed')
    expect(html).not.toContain('data-turn-change-summary')
  })

  it('keeps the empty-session composer interactive in the Electron drag shell', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/deepseek-gui',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('ds-floating-composer ds-no-drag')
    expect(html).toContain('ds-composer-shell ds-chat-composer ds-frosted ds-no-drag')
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ''
    expect(textarea).toContain('w-full')
    expect(textarea).not.toContain('disabled=""')
  })

  it('allows typing while a new chat has no selected runtime thread yet', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'draft while creating',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html.match(/<textarea[^>]*>/)?.[0] ?? '').not.toContain('disabled=""')
    expect(html).toContain('Choose a working directory before creating a thread.')
    const sendButton = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButton).toContain('disabled=""')
  })

  it('keeps the draft editable while the runtime is loading and shows send loading', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'draft during startup',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/deepseek-gui',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: false,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html.match(/<textarea[^>]*>/)?.[0] ?? '').not.toContain('disabled=""')
    const sendButton = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButton).toContain('disabled=""')
    expect(html).toContain('lucide-loader-circle')
  })
})
