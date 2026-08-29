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
import { composeWritePrompt } from '../../write/quoted-selection'
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

describe('FloatingComposer queued guidance', () => {
  it('renders compact Guide rows and disables structured payload guidance', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
        messages: [
          {
            id: 'q-text',
            text: 'use compact logo',
            displayText: 'Use compact logo',
            guidanceEligible: true
          },
          {
            id: 'q-file',
            text: 'inspect the attached file',
            guidanceEligible: false
          }
        ],
        onGuide: () => undefined,
        onRemove: () => undefined
      }))

      expect(html).toContain('Use compact logo')
      expect(html.match(/>Guide</g)).toHaveLength(2)
      expect(html).toContain('Add this input to the agent&#x27;s next model interaction')
      expect(html).toContain('Only plain-text or image follow-ups can guide')
      expect(html).toContain('disabled=""')
      expect(html).not.toContain('These messages will send automatically')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('enables image guidance, renders an image indicator, and keeps Edit disabled', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const message = {
        id: 'q-image',
        text: 'use this reference',
        attachmentIds: ['att_image'],
        attachments: [{ id: 'att_image', kind: 'image' as const, name: 'reference.png' }]
      }
      const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
        messages: [message],
        onGuide: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined
      }))

      expect(html).toContain('data-queued-message-images="1"')
      expect(html).toContain('reference.png')
      expect(html).not.toContain('disabled=""')
      expect(canEditQueuedComposerMessage(message)).toBe(false)
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('enables GUI plan image guidance while keeping Edit disabled', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const message = {
        id: 'q-plan-image',
        text: 'use the Kun mascot',
        mode: 'plan',
        guiPlan: {
          operation: 'refine' as const,
          workspaceRoot: '/workspace',
          relativePath: '.kunsdd/plan/mascot.md',
          planId: '/workspace:.kunsdd/plan/mascot.md'
        },
        attachmentIds: ['att_image'],
        attachments: [{ id: 'att_image', kind: 'image' as const, name: 'kun.png' }],
        guidanceEligible: true
      }
      const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
        messages: [message],
        onGuide: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined
      }))

      expect(html).toContain('data-queued-message-images="1"')
      expect(html).toContain('kun.png')
      expect(html).not.toContain('disabled=""')
      expect(canEditQueuedComposerMessage(message)).toBe(false)
      expect(html).not.toContain('More queued message actions')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('labels active Graph input as queued work with an explicit Graph guidance action', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: 'thr_graph_queue',
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [{ kind: 'user', id: 'user-graph', text: 'Run this as a Graph' }],
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    try {
      const html = renderToStaticMarkup(createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        orchestration: 'graph',
        graphEnabled: true,
        busy: true,
        currentTurnOrchestration: 'graph',
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'test-model',
        composerPickList: ['test-model'],
        onComposerModelChange: () => undefined,
        queuedMessages: [{
          id: 'q-graph',
          text: 'Reassign the blocked node',
          guidanceEligible: true
        }],
        onGuideQueuedMessage: () => undefined,
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined
      }))

      expect(html).toContain('sends queue until this Graph finishes')
      expect(html).toContain('Queued · Sends after this Graph finishes')
      expect(html).toContain('Guide current Graph')
      expect(html).toContain('Send this input to the current Graph Lead')
      expect(html).not.toContain('Add this input to the agent&#x27;s next model interaction')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('returns a plain-text queued message through the edit action', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    const message = {
      id: 'q-edit',
      text: 'use compact logo',
      displayText: 'Use compact logo',
      guidanceEligible: true
    }
    const onRemove = vi.fn()
    const setInput = vi.fn()
    const onEdit = (queuedMessage: Parameters<typeof returnQueuedMessageToComposer>[0]): void => {
      returnQueuedMessageToComposer(queuedMessage, onRemove, setInput)
    }
    let renderer: ReturnType<typeof createRenderer>

    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposerQueuedMessages, {
          messages: [message],
          onEdit,
          onRemove
        }))
      })

      const moreButton = renderer!.root.findAllByType('button').find(
        (button) => button.props['aria-label'] === 'More queued message actions'
      )
      expect(moreButton).toBeDefined()

      await act(async () => {
        moreButton!.props.onClick()
      })
      const menu = renderer!.root.findByProps({ role: 'menu' })
      expect(menu.props['data-queued-message-menu']).toBe(true)
      expect(menu.props.className).toContain('fixed z-[1000]')
      const editButton = renderer!.root.findByProps({ role: 'menuitem' })
      expect(editButton.findByType('span').children).toContain('Edit message')

      await act(async () => {
        editButton.props.onClick()
      })
      expect(onRemove).toHaveBeenCalledWith(message.id)
      expect(setInput).toHaveBeenCalledWith(message.displayText)
      expect(renderer!.root.findAllByProps({ role: 'menu' })).toHaveLength(0)
    } finally {
      renderer!.unmount()
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('places the queued message menu in the viewport and flips above near the bottom', () => {
    expect(calculateQueuedMessageMenuPlacement({
      anchorRect: { bottom: 152, right: 1900, top: 120 },
      viewportHeight: 900,
      viewportWidth: 1960
    })).toEqual({ left: 1724, top: 158, width: 176 })

    expect(calculateQueuedMessageMenuPlacement({
      anchorRect: { bottom: 1764, right: 3800, top: 1700 },
      viewportHeight: 1800,
      viewportWidth: 3920,
      coordinateScale: 2
    })).toEqual({ left: 1724, top: 796, width: 176 })
  })

  it('reorders multiple queued messages by drag handle or keyboard', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    const onReorder = vi.fn()
    let renderer: ReturnType<typeof createRenderer>

    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposerQueuedMessages, {
          messages: [
            { id: 'q-first', text: 'first' },
            { id: 'q-second', text: 'second' }
          ],
          onRemove: () => undefined,
          onReorder
        }))
      })

      const handles = renderer!.root.findAllByProps({
        'data-queued-message-drag-handle': true
      })
      expect(handles).toHaveLength(2)
      expect(handles[0]!.props.draggable).toBe(true)
      expect(handles[0]!.props['aria-label']).toBe('Drag to reorder queued message')

      const dataTransfer = {
        dropEffect: 'none',
        effectAllowed: 'none',
        setData: vi.fn()
      }
      await act(async () => {
        handles[0]!.props.onDragStart({ dataTransfer })
      })
      const secondRow = renderer!.root.findByProps({
        'data-queued-message-id': 'q-second'
      })
      await act(async () => {
        secondRow.props.onDragOver({
          clientY: 90,
          currentTarget: {
            getBoundingClientRect: () => ({ height: 48, top: 50 })
          },
          dataTransfer,
          preventDefault: vi.fn()
        })
      })
      expect(renderer!.root.findByProps({
        'data-queued-message-drop-indicator': 'after'
      })).toBeDefined()

      await act(async () => {
        secondRow.props.onDrop({ dataTransfer, preventDefault: vi.fn() })
      })
      expect(onReorder).toHaveBeenCalledWith('q-first', 'q-second', 'after')

      onReorder.mockClear()
      await act(async () => {
        handles[1]!.props.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() })
      })
      expect(onReorder).toHaveBeenCalledWith('q-second', 'q-first', 'before')
    } finally {
      renderer!.unmount()
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('does not dequeue structured queued payloads into a text-only editor', () => {
    expect(canEditQueuedComposerMessage({
      id: 'q-text',
      text: 'continue',
      guidanceEligible: true
    })).toBe(true)
    expect(canEditQueuedComposerMessage({
      id: 'q-file',
      text: 'inspect this',
      attachments: [{}]
    })).toBe(false)
    expect(canEditQueuedComposerMessage({
      id: 'q-plan',
      text: 'build the plan',
      mode: 'plan'
    })).toBe(false)
  })

  it('disables guidance when a compact sidebar row carries structured context', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    try {
      const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
        messages: [{
          id: 'q-design',
          text: 'make the card smaller',
          guiDesignMode: true
        }],
        onGuide: () => undefined,
        onRemove: () => undefined
      }))

      expect(html).toContain('aria-label="Guide"')
      expect(html).toContain('disabled=""')
      expect(html).toContain('Only plain-text or image follow-ups can guide')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('shows only the user input for a queued Write prompt', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    const prompt = composeWritePrompt('Make the title shorter.', {
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md'
    })
    try {
      const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
        messages: [{
          id: 'q-write',
          text: prompt,
          writeContext: {
            workspaceRoot: '/workspace/deepseek-gui',
            activeFilePath: '/workspace/deepseek-gui/draft.md',
            documentEpoch: 4,
            contentRevision: 2,
            threadId: 'thr_write'
          }
        }],
        onGuide: () => undefined,
        onRemove: () => undefined
      }))

      expect(html).toContain('Make the title shorter.')
      expect(html).not.toContain('/workspace/deepseek-gui')
      expect(html).toContain('disabled=""')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('hides a durable in-flight item while keeping later pending items visible', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerQueuedMessages, {
      messages: [
        {
          id: 'q-running',
          text: 'already running',
          deliveryState: 'in_flight',
          deliveryTurnId: 'turn-running'
        },
        {
          id: 'q-pending',
          text: 'send this next',
          deliveryState: 'pending'
        }
      ],
      onRemove: () => undefined
    }))

    expect(html).not.toContain('already running')
    expect(html).toContain('send this next')
  })

})

describe('FloatingComposer slash commands', () => {
  it('parses compact command aliases', () => {
    expect(parseCompactCommand('/compact')).toEqual({})
    expect(parseCompactCommand('/compress')).toEqual({})
    expect(parseCompactCommand('/summarize')).toEqual({})
    expect(parseCompactCommand('/压缩')).toEqual({})
    expect(parseCompactCommand('/压缩会话')).toEqual({})
    expect(parseCompactCommand('/总结')).toEqual({})
  })

  it('parses compact reasons and ignores adjacent command names', () => {
    expect(parseCompactCommand('/compact preparing for a long continuation')).toEqual({
      reason: 'preparing for a long continuation'
    })
    expect(parseCompactCommand('/压缩会话 继续实现前整理上下文')).toEqual({
      reason: '继续实现前整理上下文'
    })
    expect(parseCompactCommand('/compactness')).toBeNull()
    expect(parseCompactCommand('please /compact')).toBeNull()
  })

  it('parses goal command controls and objectives', () => {
    expect(parseGoalCommand('/goal')).toEqual({ action: 'menu' })
    expect(parseGoalCommand('/goal pause')).toEqual({ action: 'pause' })
    expect(parseGoalCommand('/goal resume')).toEqual({ action: 'resume' })
    expect(parseGoalCommand('/goal clear')).toEqual({ action: 'clear' })
    expect(parseGoalCommand('/goal ship the feature')).toEqual({
      action: 'set',
      objective: 'ship the feature'
    })
    expect(parseGoalCommand('/goalkeeper')).toBe(false)
  })

  it('parses new session command aliases', () => {
    expect(parseNewCommand('/new')).toBe(true)
    expect(parseNewCommand('/new-thread')).toBe(true)
    expect(parseNewCommand('/新建会话')).toBe(true)
    expect(parseNewCommand('/new current task')).toBe(false)
    expect(parseNewCommand('/new-topic')).toBe(false)
  })

  it('parses review command targets', () => {
    expect(parseReviewCommand('/review')).toEqual({ kind: 'uncommittedChanges' })
    expect(parseReviewCommand('/review base main')).toEqual({ kind: 'baseBranch', branch: 'main' })
    expect(parseReviewCommand('/review branch release/1.2')).toEqual({ kind: 'baseBranch', branch: 'release/1.2' })
    expect(parseReviewCommand('/review commit abc123')).toEqual({ kind: 'commit', sha: 'abc123' })
    expect(parseReviewCommand('/review focus on auth regressions')).toEqual({
      kind: 'custom',
      instructions: 'focus on auth regressions'
    })
    expect(parseReviewCommand('/reviewer')).toBe(false)
  })

  it('parses research topics and fills the research brief', () => {
    expect(parseResearchCommand('/research')).toBeNull()
    expect(parseResearchCommand('/deepresearch cache economics')).toBe('cache economics')
    expect(parseResearchCommand('/deep-research web + papers')).toBe('web + papers')
    expect(parseResearchCommand('/researcher')).toBe(false)
    expect(buildResearchPrompt('Topic: {{topic}}', 'provider cache')).toBe('Topic: provider cache')
    expect(buildResearchPrompt('Topic: {{topic}}', null)).toBe('Topic: {{topic}}')
  })

  it('uses ordinary composer text as a goal draft only when the goal panel is open', () => {
    expect(getGoalPanelDraftObjective('ship the goal UX', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('  ship the goal UX  ', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('ship the goal UX', false)).toBe('')
    expect(getGoalPanelDraftObjective('/goal pause', true)).toBe('')
    expect(getGoalPanelDraftObjective('/compact after this', true)).toBe('')
  })
})

describe('FloatingComposer goal helpers', () => {
  it('formats elapsed goal time compactly', () => {
    expect(formatGoalElapsedSeconds(3)).toBe('3s')
    expect(formatGoalElapsedSeconds(60)).toBe('1m')
    expect(formatGoalElapsedSeconds(125)).toBe('2m 5s')
    expect(formatGoalElapsedSeconds(3720)).toBe('1h 2m')
  })

  it('shows the goal banner only when no other composer overlay is active', () => {
    expect(shouldShowGoalFloater({
      compact: false,
      hasActiveGoal: true,
      slashQuery: null,
      goalPanelOpen: false,
      composerMenuOpen: false
    })).toBe(true)

    expect(shouldShowGoalFloater({
      compact: true,
      hasActiveGoal: true,
      slashQuery: null,
      goalPanelOpen: false,
      composerMenuOpen: false
    })).toBe(false)

    expect(shouldShowGoalFloater({
      compact: false,
      hasActiveGoal: true,
      slashQuery: 'goal',
      goalPanelOpen: false,
      composerMenuOpen: false
    })).toBe(false)

    expect(shouldShowGoalFloater({
      compact: false,
      hasActiveGoal: true,
      slashQuery: null,
      goalPanelOpen: true,
      composerMenuOpen: false
    })).toBe(false)

    expect(shouldShowGoalFloater({
      compact: false,
      hasActiveGoal: false,
      slashQuery: null,
      goalPanelOpen: false,
      composerMenuOpen: false
    })).toBe(false)
  })

  it('scrolls keyboard-highlighted menu items into view', () => {
    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 0,
      containerClientHeight: 100,
      itemOffsetTop: 120,
      itemOffsetHeight: 30
    })).toBe(50)

    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 60,
      containerClientHeight: 100,
      itemOffsetTop: 30,
      itemOffsetHeight: 24
    })).toBe(30)

    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 40,
      containerClientHeight: 100,
      itemOffsetTop: 70,
      itemOffsetHeight: 24
    })).toBe(40)
  })
})
