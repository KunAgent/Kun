import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer } from 'react-test-renderer'
import { readStylesheetBundle } from '../../testing/stylesheet-bundle'
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
  it('renders the permission menu as a compact borderless list', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('zh')

    try {
      const html = renderToStaticMarkup(
        createElement(FloatingComposerPermissionMenuContent, {
          permissionMode: 'full-access',
          onSelect: () => undefined,
          onOpenPermissionSettings: () => undefined
        })
      )
      const optionClasses = Array.from(
        html.matchAll(/class="([^"]*ds-composer-permission-option [^"]*)"/g),
        (match) => match[1]
      )

      expect(html).toContain('Kun 如何执行操作？')
      expect(html).toContain('了解权限')
      expect(html.match(/role="menuitemradio"/g)).toHaveLength(3)
      expect(html).toContain('data-permission-mode="full-access" aria-checked="true"')
      expect(html).toContain('lucide-check')
      expect(optionClasses).toHaveLength(3)
      expect(optionClasses.every((className) => !className.split(/\s+/).includes('border'))).toBe(true)
      expect(
        optionClasses.every(
          (className) => !className.split(/\s+/).some((name) => name.startsWith('bg-'))
        )
      ).toBe(true)
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('opens permission settings from the menu header action', async () => {
    const onOpenPermissionSettings = vi.fn()
    let renderer!: ReturnType<typeof createRenderer>

    await act(async () => {
      renderer = createRenderer(
        createElement(FloatingComposerPermissionMenuContent, {
          permissionMode: 'ask-for-approval',
          onSelect: () => undefined,
          onOpenPermissionSettings
        })
      )
    })
    await act(async () => {
      renderer.root.findByProps({ role: 'menuitem' }).props.onClick()
    })

    expect(onOpenPermissionSettings).toHaveBeenCalledOnce()
    await act(async () => {
      renderer.unmount()
    })
  })

  it('declares progressive container-width fallbacks for secondary toolbar controls', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const [composerSource, css] = await Promise.all([
      readFile(new URL('./FloatingComposerSurfaceView.tsx', import.meta.url), 'utf8'),
      readStylesheetBundle(new URL('../../styles/base-shell.css', import.meta.url))
    ])

    expect(composerSource).toContain('ds-composer-voice-action')
    expect(composerSource).toContain('ds-composer-prompt-optimize-action')
    expect(css).toContain('@container (max-width: 760px)')
    expect(css).toContain('.ds-composer-optional-action')
    expect(css).toContain('@container (max-width: 700px)')
    expect(css).toContain('.ds-composer-mode-label,')
    expect(css).toContain('.ds-composer-permission-label,')
    expect(css).toContain('.ds-composer-context-control,')
    expect(css).toContain('.ds-composer-agent-picker')
  })

  it('shows voice dictation for every runnable speech configuration', () => {
    expect(shouldShowVoiceDictation({
      enabled: true,
      providerId: 'gemini-cli-subscription',
      protocol: 'gemini-cli-audio',
      baseUrl: '',
      apiKey: '',
      model: 'gemini-3.1-pro-preview',
      localWhisperDownloadSource: 'huggingface',
      language: 'zh',
      timeoutMs: 60_000
    })).toBe(true)

    expect(shouldShowVoiceDictation({
      enabled: true,
      providerId: 'custom',
      protocol: 'openai-transcriptions',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-1',
      localWhisperDownloadSource: 'huggingface',
      language: '',
      timeoutMs: 60_000
    })).toBe(false)

    expect(shouldShowVoiceDictation({
      enabled: true,
      providerId: 'grok-subscription',
      protocol: 'xai-stt',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      model: 'grok-transcribe',
      localWhisperDownloadSource: 'huggingface',
      language: '',
      timeoutMs: 60_000
    })).toBe(false)

    expect(shouldShowVoiceDictation({
      enabled: true,
      providerId: 'grok-subscription',
      protocol: 'xai-stt',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      model: 'grok-transcribe',
      localWhisperDownloadSource: 'huggingface',
      language: '',
      timeoutMs: 60_000
    }, true)).toBe(true)
  })

  it('surfaces user-input requests in Chat, Design, and the compact Write composer', () => {
    expect(shouldSurfaceComposerUserInput('chat', false)).toBe(true)
    expect(shouldSurfaceComposerUserInput('design', false)).toBe(true)
    expect(shouldSurfaceComposerUserInput('write', false)).toBe(true)
    expect(shouldSurfaceComposerUserInput('write', true)).toBe(true)
    expect(shouldSurfaceComposerUserInput('claw', false)).toBe(false)
    expect(shouldSurfaceComposerUserInput('design', true)).toBe(false)
  })

  it('hides the default slash footer hint but keeps status hints', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      runtimeConnection: 'ready',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    const baseProps = {
      input: '',
      setInput: () => undefined,
      workspaceRootOverride: '/workspace/deepseek-gui',
      mode: 'agent' as const,
      setMode: () => undefined,
      busy: false,
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
    }

    try {
      const readyHtml = renderToStaticMarkup(
        createElement(FloatingComposer, {
          ...baseProps,
          runtimeReady: true
        })
      )
      const offlineHtml = renderToStaticMarkup(
        createElement(FloatingComposer, {
          ...baseProps,
          runtimeReady: false
        })
      )

      expect(readyHtml).not.toContain('Type / for commands')
      expect(offlineHtml).toContain('Reconnect the runtime before sending another message.')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('renders localized execution values in Chinese without visible category prefixes', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('zh')

    try {
      const html = renderToStaticMarkup(
        createElement(FloatingComposerExecutionPicker, {
          value: {
            approvalPolicy: 'auto',
            sandboxMode: 'danger-full-access',
            approvalReviewer: 'user'
          },
          onChange: () => undefined
        })
      )

      expect(html).toContain('完全访问')
      expect(html).not.toContain('>审批<')
      expect(html).not.toContain('>权限<')
      expect(html).toContain('aria-label="工具权限"')
      expect(html).toContain('data-permission-mode="full-access"')
      expect(html).toContain('lucide-lock-keyhole-open')
      expect(html).toContain('ds-composer-permission-label')
      expect(html).toContain('ds-composer-permission-chevron')
      expect(html).toContain('focus-visible:outline')
      expect(html).toContain('focus-visible:outline-orange-500')
      expect(html).toContain('hover:text-orange-700')
      expect(html).not.toContain('bg-orange-')
      expect(html).not.toContain('bg-ds-hover')
      expect(html).not.toContain('border-transparent')
      expect(html).not.toContain('shadow-none')
      expect(html).not.toContain('Full access')
      expect(html).not.toContain('Auto')
      expect(html).not.toContain('Bypass')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('renders the ask-for-approval permission mode in the execution picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerExecutionPicker, {
        value: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'user'
        },
        onChange: () => undefined
      })
    )

    expect(html).toContain('Ask for approval')
    expect(html).toContain('approval-worthy writes, commands, network, and external effects ask you first')
    expect(html).toContain('aria-label="Tool permission"')
    expect(html).toContain('data-permission-mode="ask-for-approval"')
    expect(html).toContain('lucide-hand')
  })

  it('renders the approve-for-me permission mode in the execution picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerExecutionPicker, {
        value: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'agent'
        },
        onChange: () => undefined
      })
    )

    expect(html).toContain('Approve for me')
    expect(html).toContain('selected model reviews approval-worthy actions')
    expect(html).toContain('aria-label="Tool permission"')
    expect(html).toContain('data-permission-mode="approve-for-me"')
    expect(html).toContain('lucide-bot')
  })

  it('renders approve-for-me in Chinese', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('zh')

    try {
      const html = renderToStaticMarkup(
        createElement(FloatingComposerExecutionPicker, {
          value: {
            approvalPolicy: 'on-request',
            sandboxMode: 'workspace-write',
            approvalReviewer: 'agent'
          },
          onChange: () => undefined
        })
      )

      expect(html).toContain('替我审批')
      expect(html).toContain('由输入框所选模型审查需审批操作')
      expect(html).toContain('data-permission-mode="approve-for-me"')
      expect(html).toContain('lucide-bot')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('enables goal setup before a thread exists when a workspace is available', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: ''
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/goal',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        workspaceRootOverride: '/workspace/deepseek-gui',
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

    const goalButton = html.match(/<button[^>]*>[\s\S]*?\/goal[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(goalButton).toContain('/goal')
    expect(goalButton).not.toContain('disabled=""')
  })

  it('enables new session before a thread exists when a workspace is available', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: ''
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/new',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        workspaceRootOverride: '/workspace/deepseek-gui',
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onNewCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const newButton = html.match(/<button[^>]*>[\s\S]*?\/new[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(newButton).toContain('/new')
    expect(newButton).not.toContain('disabled=""')
  })

  it('enables plan mode before a thread exists when a workspace is available', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: ''
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/plan',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        workspaceRootOverride: '/workspace/deepseek-gui',
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onPlanCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const planButton = html.match(/<button[^>]*>[\s\S]*?\/plan[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(planButton).toContain('/plan')
    expect(planButton).not.toContain('disabled=""')
  })

})
