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

describe('FloatingComposer capability controls', () => {
  it('shows discovered project Skills in the slash command menu', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/openspec',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/deepseek-gui',
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
        skillCommands: [{
          id: 'openspec-apply-change',
          name: 'Openspec Apply Change',
          description: 'Implement tasks from an OpenSpec change',
          root: '/workspace/deepseek-gui/.codex/skills/openspec-apply-change'
        }]
      })
    )

    expect(html).toContain('Openspec Apply Change')
    expect(html).toContain('Implement tasks from an OpenSpec change')
    expect(html).toContain('Project')
    expect(html).toContain('/skill:openspec-apply-change')
  })

  it('hides disabled Skills from the slash command menu', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/skill',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/deepseek-gui',
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
        disabledSkillIds: ['/skill:test-skill-08'],
        skillCommands: [
          {
            id: 'test-skill-08',
            name: 'Test Skill 08',
            description: 'Disabled test skill',
            root: '/workspace/deepseek-gui/.agents/skills/test-skill-08'
          },
          {
            id: 'test-skill-09',
            name: 'Test Skill 09',
            description: 'Enabled test skill',
            root: '/workspace/deepseek-gui/.agents/skills/test-skill-09'
          }
        ]
      })
    )

    expect(html).not.toContain('Test Skill 08')
    expect(html).not.toContain('/skill:test-skill-08')
    expect(html).toContain('Test Skill 09')
    expect(html).toContain('/skill:test-skill-09')
  })

  it('enables local Claw input when a WeChat channel is already mapped to a local thread', () => {
    useChatStore.setState({
      activeThreadId: 'thr_weixin',
      activeThreadGoal: null,
      route: 'claw',
      workspaceRoot: '',
      activeClawChannelId: 'channel_weixin',
      clawChannels: [{
        id: 'channel_weixin',
        provider: 'weixin',
        label: 'weixin agent',
        enabled: true,
        model: 'auto',
        threadId: 'thr_weixin',
        workspaceRoot: '',
        agentProfile: {
          name: '',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        platformCredential: {
          kind: 'weixin',
          accountId: 'wx_account',
          sessionKey: 'wx_session',
          createdAt: '2026-06-02T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'auto',
        composerPickList: ['auto'],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ''
    expect(textarea).not.toContain('disabled=""')
    expect(textarea).not.toContain('先去飞书')
  })

  it('hides image upload when attachment upload is unavailable', () => {
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
        webAccessAvailable: false
      })
    )
    expect(html).not.toContain('Attach image')
    expect(html).not.toContain('Image input is unavailable')
  })

  it('renders the plus trigger alongside uploaded attachments', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'describe this',
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
        attachments: [{ id: 'att_1', name: 'shot.png', mimeType: 'image/png' }],
        attachmentUploadEnabled: true,
        webAccessAvailable: true,
        onRemoveAttachment: () => undefined
      })
    )
    expect(html).toContain('More actions')
    expect(html).not.toContain('Attach image')
    expect(html).toContain('shot.png')
  })

  it('keeps busy Code model and reasoning controls enabled for the next input', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['deepseek-v4-pro'],
        composerModelGroups: [DEEPSEEK_PROVIDER_GROUP],
        composerReasoningEffort: 'high',
        modelControlVariant: 'split',
        onComposerModelChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Queue message')
    const modelTrigger = html.match(/<button[^>]*aria-label="Model: DeepSeek \/ deepseek-v4-pro"[^>]*>/)?.[0]
    const reasoningTrigger = html.match(/<button[^>]*aria-label="Reasoning: High"[^>]*>/)?.[0]
    expect(modelTrigger).toBeDefined()
    expect(modelTrigger).not.toContain('disabled=""')
    expect(reasoningTrigger).toBeDefined()
    expect(reasoningTrigger).not.toContain('disabled=""')
    expect(html).not.toContain('Stop and discard')
    expect(html).not.toContain('lucide-trash-2')
    expect(html).not.toContain('lucide-zap')
    expect(html).not.toContain('Default (thread)')
  })

  it('renders the model control chip without an empty default option', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['auto', 'deepseek-v4-flash', 'deepseek-v4-pro'],
        composerModelGroups: [DEEPSEEK_PROVIDER_GROUP],
        canChangeModel: true,
        composerReasoningEffort: 'max',
        onComposerReasoningEffortChange: () => undefined,
        onComposerModelChange: () => undefined
      })
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Ultra')
    expect(html).toContain('Model and reasoning settings')
    expect(html).not.toContain('>Auto<')
    expect(html).not.toContain('<option value=""></option>')
    expect(html).not.toContain('Default (thread)')
  })

  it('renders compact combobox controls as a picker button with model and reasoning labels', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: true,
        mode: 'combobox',
        composerModel: 'deepseek-v4-flash',
        composerPickList: ['auto', 'deepseek-v4-flash', 'deepseek-v4-pro'],
        composerModelGroups: [DEEPSEEK_PROVIDER_GROUP],
        canChangeModel: true,
        composerReasoningEffort: 'high',
        onComposerReasoningEffortChange: () => undefined,
        onComposerModelChange: () => undefined
      })
    )

    expect(html).toContain('deepseek-v4-flash')
    expect(html).toContain('High')
    expect(html).toContain('Model and reasoning settings')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('<input')
  })

  it('shows a plan badge in the input toolbar when plan mode is enabled', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'plan this',
        setInput: () => undefined,
        mode: 'plan',
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
        onPlanCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )
    expect(html).toContain('data-composer-plan-mode-badge')
    expect(html).toContain('title="Cancel Plan"')
    expect(html).toContain('>Plan</span>')
  })

})
