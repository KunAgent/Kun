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

describe('FloatingComposer usage history visibility', () => {
  it('keeps the history entry discoverable before the first message', () => {
    expect(shouldShowUsageHistory({
      compact: false,
      route: 'chat',
      runtimeReady: true
    })).toBe(true)
    expect(shouldShowUsageHistory({
      compact: false,
      route: 'chat',
      runtimeReady: false
    })).toBe(false)
    expect(shouldShowUsageHistory({
      compact: true,
      route: 'chat',
      runtimeReady: true
    })).toBe(false)
    expect(shouldShowUsageHistory({
      compact: false,
      route: 'write',
      runtimeReady: true
    })).toBe(false)
  })
})

describe('FloatingComposer automatic mode', () => {
  it('renders the automatic mode badge with its icon', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })

    const html = renderToStaticMarkup(createElement(FloatingComposer, {
      input: '',
      setInput: () => undefined,
      mode: 'auto',
      setMode: () => undefined,
      busy: false,
      runtimeReady: true,
      hasActiveThread: false,
      composerModel: 'test-model',
      composerPickList: ['test-model'],
      onComposerModelChange: () => undefined,
      queuedMessages: [],
      onRemoveQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined
    }))

    expect(html).toContain('data-composer-auto-plan-build-mode-badge')
    expect(html).toContain('lucide-bot')
  })
})

describe('FloatingComposer workspace controls visibility', () => {
  it('shows workspace and branch controls until the conversation starts', () => {
    expect(shouldShowWorkspaceControls({
      compact: false,
      route: 'chat',
      hasActiveThread: false,
      hasConversationStarted: false
    })).toBe(true)
    expect(shouldShowWorkspaceControls({
      compact: false,
      route: 'chat',
      hasActiveThread: true,
      hasConversationStarted: false
    })).toBe(true)
    expect(shouldShowWorkspaceControls({
      compact: false,
      route: 'chat',
      hasActiveThread: true,
      hasConversationStarted: true
    })).toBe(false)
    expect(shouldShowWorkspaceControls({
      compact: true,
      route: 'chat',
      hasActiveThread: false,
      hasConversationStarted: false
    })).toBe(false)
    expect(shouldShowWorkspaceControls({
      compact: false,
      route: 'write',
      hasActiveThread: false,
      hasConversationStarted: false
    })).toBe(false)
  })

  it('renders the workspace and branch controls above the input shell for an empty active thread', () => {
    useChatStore.setState({
      activeThreadId: 'thr_empty',
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: [{
        id: 'thr_empty',
        title: 'New chat',
        updatedAt: '2026-07-27T00:00:00.000Z',
        model: 'test-model',
        mode: 'agent',
        workspace: '/Users/test/code/acme-project'
      }]
    })

    const html = renderToStaticMarkup(createElement(FloatingComposer, {
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      busy: false,
      runtimeReady: false,
      hasActiveThread: true,
      workspaceRootOverride: '/Users/test/code/acme-project',
      composerModel: '',
      composerPickList: [],
      onComposerModelChange: () => undefined,
      queuedMessages: [],
      onRemoveQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined
    }))

    const controlsIndex = html.indexOf('data-composer-workspace-controls')
    const composerIndex = html.indexOf('ds-composer-shell')
    expect(controlsIndex).toBeGreaterThanOrEqual(0)
    expect(html.slice(controlsIndex, composerIndex)).toContain('ds-workspace-project-picker')
    expect(html.slice(controlsIndex, composerIndex)).toContain('ds-git-branch-picker')
    expect(composerIndex).toBeGreaterThan(controlsIndex)
  })

  it('places the text-only new requirement action after the branch in empty Code mode', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })

    const renderComposer = (taskSurface: 'code' | 'design'): string =>
      renderToStaticMarkup(createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        taskSurface,
        emptyTaskLayout: true,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        composerModel: 'test-model',
        composerPickList: ['test-model'],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onNewRequirement: () => undefined
      }))

    const codeHtml = renderComposer('code')
    const controls = codeHtml.slice(
      codeHtml.indexOf('data-composer-workspace-controls'),
      codeHtml.indexOf('ds-composer-shell')
    )
    expect(controls).toContain('data-composer-new-requirement')
    expect(controls).toContain('New requirement')
    expect(controls.indexOf('ds-composer-new-requirement'))
      .toBeGreaterThan(controls.indexOf('ds-git-branch-picker'))
    expect(controls).not.toMatch(/ds-composer-new-requirement[^>]*><svg/)

    expect(renderComposer('design')).not.toContain('data-composer-new-requirement')
  })
})

describe('FloatingComposer Graph entry', () => {
  it('hides Graph controls and status while Graph is disabled', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })

    const html = renderToStaticMarkup(createElement(FloatingComposer, {
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      orchestration: 'graph',
      graphEnabled: false,
      onOrchestrationChange: () => undefined,
      busy: true,
      currentTurnOrchestration: 'graph',
      runtimeReady: true,
      hasActiveThread: true,
      composerModel: 'test-model',
      composerPickList: ['test-model'],
      onComposerModelChange: () => undefined,
      queuedMessages: [],
      onRemoveQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined,
      onPlanCommand: () => undefined
    }))

    expect(html).not.toContain('data-composer-graph-menu-item')
    expect(html).not.toContain('data-composer-graph-running')
    expect(html).not.toContain('data-composer-graph-active')
    expect(html).not.toContain('data-composer-stack-item="graph"')
  })

  it('keeps Graph inside the plus menu and selects it explicitly', async () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [{ kind: 'user', id: 'user-graph', text: 'Use Graph' }],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })
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
    const setMode = vi.fn()
    const setOrchestration = vi.fn()
    let renderer!: ReturnType<typeof createRenderer>

    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposer, {
          input: '',
          setInput: () => undefined,
          mode: 'agent',
          setMode,
          orchestration: 'direct',
          graphEnabled: true,
          onOrchestrationChange: setOrchestration,
          busy: false,
          runtimeReady: true,
          hasActiveThread: true,
          composerModel: 'test-model',
          composerPickList: ['test-model'],
          onComposerModelChange: () => undefined,
          queuedMessages: [],
          onRemoveQueuedMessage: () => undefined,
          onSend: () => undefined,
          onInterrupt: () => undefined,
          onPlanCommand: () => undefined
        }))
      })

      expect(renderer!.root.findAllByProps({ 'data-composer-graph-menu-item': true }))
        .toHaveLength(0)
      expect(renderer!.root.findAllByProps({ 'data-composer-graph-active': true }))
        .toHaveLength(0)

      const plusButton = renderer!.root.findAllByType('button').find(
        (button) => String(button.props.className).includes('ds-composer-menu-button')
      )
      expect(plusButton).toBeDefined()
      await act(async () => {
        plusButton!.props.onClick()
      })

      const graphMenuItem = renderer!.root.findByProps({
        'data-composer-graph-menu-item': true
      })
      expect(graphMenuItem.props.disabled).toBe(false)
      await act(async () => {
        graphMenuItem.props.onClick()
      })

      expect(setMode).toHaveBeenCalledWith('agent')
      expect(setOrchestration).toHaveBeenCalledWith('graph')
    } finally {
      if (renderer) {
        await act(async () => {
          renderer.unmount()
        })
      }
      vi.unstubAllGlobals()
    }
  })

  it('shows only a compact Graph state after explicit selection', () => {
    useChatStore.setState({
      activeThreadId: 'thr_graph_active',
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: [{
        id: 'thr_graph_active',
        title: 'Graph chat',
        updatedAt: '2026-07-27T00:00:00.000Z',
        model: 'test-model',
        mode: 'agent',
        workspace: '/Users/test/code/acme-project'
      }]
    })

    const html = renderToStaticMarkup(createElement(FloatingComposer, {
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      orchestration: 'graph',
      graphEnabled: true,
      onOrchestrationChange: () => undefined,
      busy: false,
      runtimeReady: true,
      hasActiveThread: true,
      composerModel: 'test-model',
      composerPickList: ['test-model'],
      onComposerModelChange: () => undefined,
      queuedMessages: [],
      onRemoveQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined,
      onPlanCommand: () => undefined
    }))

    expect(html).toContain('data-composer-graph-active')
    expect(html).toContain('ds-composer-mode-badge')
    expect(html).toContain('ds-composer-mode-label')
    expect(html).not.toContain('data-composer-graph-menu-item')
    expect(html).not.toContain('graphModeSelector')
  })

  it('shows restored running Graph truth while the disabled switch remains Direct for the next turn', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [{ kind: 'user', id: 'user-graph-running', text: 'Run Graph' }],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })
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
    let renderer!: ReturnType<typeof createRenderer>

    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposer, {
          input: '',
          setInput: () => undefined,
          mode: 'agent',
          setMode: () => undefined,
          orchestration: 'direct',
          graphEnabled: true,
          onOrchestrationChange: () => undefined,
          busy: true,
          currentTurnOrchestration: 'graph',
          runtimeReady: true,
          hasActiveThread: true,
          composerModel: 'test-model',
          composerPickList: ['test-model'],
          onComposerModelChange: () => undefined,
          queuedMessages: [],
          onRemoveQueuedMessage: () => undefined,
          onSend: () => undefined,
          onInterrupt: () => undefined,
          onPlanCommand: () => undefined
        }))
      })

      const runningBadge = renderer.root.findByProps({
        'data-composer-graph-running': true
      })
      expect(runningBadge.props['aria-label']).toBe('Running: Graph')
      expect(String(runningBadge.props.className)).toContain('ds-composer-mode-badge')
      expect(renderer.root.findAllByProps({ 'data-composer-graph-active': true })).toHaveLength(0)

      const plusButton = renderer.root.findAllByType('button').find(
        (button) => String(button.props.className).includes('ds-composer-menu-button')
      )
      expect(plusButton).toBeDefined()
      await act(async () => {
        plusButton!.props.onClick()
      })

      const graphMenuItem = renderer.root.findByProps({
        'data-composer-graph-menu-item': true
      })
      expect(graphMenuItem.props.disabled).toBe(true)
      expect(graphMenuItem.props['aria-label']).toBe('Next turn: Graph')
      expect(graphMenuItem.props.title).toBe(
        'Controls the next turn and cannot change the turn already running'
      )
      const graphSwitch = graphMenuItem.findByProps({ role: 'switch' })
      expect(graphSwitch.props['aria-checked']).toBe(false)
    } finally {
      if (renderer) {
        await act(async () => {
          renderer.unmount()
        })
      }
      await i18n.changeLanguage(previousLanguage)
      vi.unstubAllGlobals()
    }
  })

  it('replaces the running Graph badge when planning pauses for correction', async () => {
    const previousGraphState = useGraphStore.getState()
    useChatStore.setState({
      activeThreadId: 'thr_graph_correction',
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [{
        kind: 'user',
        id: 'user_graph_correction',
        turnId: 'turn_graph_correction',
        text: 'Implement TimeKV'
      }],
      route: 'chat',
      workspaceRoot: '/Users/test/code/acme-project',
      threads: []
    })
    useGraphStore.setState({
      runs: [],
      drafts: [{
        draft: {
          version: 1,
          id: 'draft_graph_correction',
          reservedRunId: 'run_reserved',
          threadId: 'thr_graph_correction',
          sourceTurnId: 'turn_graph_correction',
          projectId: 'project_1',
          goal: 'Implement TimeKV.',
          revision: 3,
          status: 'needs_correction',
          issues: [],
          repairCount: 1,
          createdAt: '2026-07-31T00:00:00.000Z',
          updatedAt: '2026-07-31T00:00:01.000Z'
        },
        tasks: []
      }],
      selectedRunId: null,
      refreshThread: vi.fn().mockResolvedValue(undefined)
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      kunGui: {
        getSettings: vi.fn(async () => ({ composerSendKey: 'enter' })),
        runtimeRequest: vi.fn(async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({ sessions: [], running: 0 })
        }))
      }
    })
    let renderer!: ReturnType<typeof createRenderer>

    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposer, {
          input: '',
          setInput: () => undefined,
          mode: 'agent',
          setMode: () => undefined,
          orchestration: 'direct',
          graphEnabled: true,
          onOrchestrationChange: () => undefined,
          busy: true,
          currentTurnOrchestration: 'graph',
          runtimeReady: true,
          hasActiveThread: true,
          composerModel: 'test-model',
          composerPickList: ['test-model'],
          onComposerModelChange: () => undefined,
          queuedMessages: [],
          onRemoveQueuedMessage: () => undefined,
          onSend: () => undefined,
          onInterrupt: () => undefined,
          onPlanCommand: () => undefined
        }))
      })

      expect(renderer.root.findAllByProps({
        'data-composer-graph-needs-correction': true
      })).toHaveLength(1)
      expect(renderer.root.findAllByProps({
        'data-composer-graph-running': true
      })).toHaveLength(0)
      expect(renderer.root.findAllByProps({
        'data-graph-planning-correction': true
      })).toHaveLength(1)
    } finally {
      if (renderer) {
        await act(async () => renderer.unmount())
      }
      useGraphStore.setState({
        runs: previousGraphState.runs,
        drafts: previousGraphState.drafts,
        selectedRunId: previousGraphState.selectedRunId,
        refreshThread: previousGraphState.refreshThread
      })
      vi.unstubAllGlobals()
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    }
  })
})
