import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('FloatingComposer model controls', () => {
  it('keeps execution menus anchored when the app UI is zoomed', () => {
    const placement = calculateExecutionMenuPlacement({
      anchorRect: { top: 624, left: 240, bottom: 648, width: 96 },
      menuWidth: 184,
      menuHeight: 190,
      viewportHeight: 720,
      viewportWidth: 800,
      coordinateScale: 0.8
    })

    expect(placement.left).toBe(268)
    expect(placement.top).toBe(582)
  })

  it('places the model submenu beside the active provider row', () => {
    const placement = calculateFloatingSubmenuPlacement({
      anchorRect: { top: 650, right: 700, bottom: 686, left: 492 },
      submenuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(706)
    expect(placement.top).toBe(642)
  })

  it('flips the model submenu left when there is not enough room on the right', () => {
    const placement = calculateFloatingSubmenuPlacement({
      anchorRect: { top: 650, right: 920, bottom: 686, left: 712 },
      submenuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(474)
    expect(placement.top).toBe(642)
  })

  it('keeps non-text models out of the composer model menu', () => {
    const group = {
      modelProfiles: {
        'glm-4v': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'banana-canvas': {
          inputModalities: ['text'],
          outputModalities: ['image'],
          supportsToolCalling: false,
          messageParts: ['text']
        }
      }
    } satisfies Parameters<typeof composerMenuSupportsModel>[0]

    expect(composerMenuSupportsModel(group, 'glm-4v')).toBe(true)
    expect(composerMenuSupportsModel(group, 'unknown-chat-model')).toBe(true)
    expect(composerMenuSupportsModel(group, 'banana-canvas')).toBe(false)
    expect(composerMenuSupportsModel(group, 'whisper-1')).toBe(false)
    expect(composerMenuSupportsModel(group, 'dall-e-3')).toBe(false)
    expect(composerMenuSupportsModel(group, 'seedream-4-0-250828')).toBe(false)
    expect(composerMenuSupportsModel(group, 'text-embedding-3-large')).toBe(false)
  })

  it('keeps provider model aliases out of the ungrouped fallback menu', () => {
    const groups = buildComposerModelMenuGroups({
      composerModelGroups: [{
        providerId: 'minimax-token-plan',
        label: 'MiniMax Token Plan',
        modelIds: ['minimax-m3'],
        modelProfiles: {
          'minimax-m3': {
            aliases: ['MiniMax-M3'],
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        }
      }],
      modelOptions: ['MiniMax-M3', 'loose-model'],
      ungroupedLabel: 'Other models'
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      providerId: 'minimax-token-plan',
      modelIds: ['minimax-m3']
    })
    expect(groups[1]).toMatchObject({
      providerId: '__composer_models__',
      label: 'Other models',
      modelIds: ['loose-model']
    })
  })

  it('builds model picker options only from configured picks, not the current model', () => {
    expect(buildComposerModelOptions([
      ' deepseek-v4-pro ',
      'mock-model',
      'deepseek-v4-pro',
      ' '
    ])).toEqual(['deepseek-v4-pro', 'mock-model'])
    expect(buildComposerModelOptions(['deepseek-v4-pro'])).not.toContain('stale-thread-model')
  })

  it('deduplicates models within a provider but keeps the same model id across providers', () => {
    const groups = buildComposerModelMenuGroups({
      composerModelGroups: [
        {
          providerId: 'deepseek',
          label: 'DeepSeek',
          modelIds: ['deepseek-v4-pro', 'deepseek-v4-pro'],
          modelProfiles: {}
        },
        {
          providerId: 'custom-provider-3',
          label: 'test',
          modelIds: ['deepseek-v4-pro'],
          modelProfiles: {}
        }
      ],
      modelOptions: ['deepseek-v4-pro'],
      ungroupedLabel: 'Other models'
    })

    expect(groups).toEqual([
      expect.objectContaining({
        providerId: 'deepseek',
        modelIds: ['deepseek-v4-pro']
      }),
      expect.objectContaining({
        providerId: 'custom-provider-3',
        modelIds: ['deepseek-v4-pro']
      })
    ])
  })

  it('selects duplicate model ids by provider and model id together', () => {
    expect(composerModelMenuItemSelected({
      groupProviderId: 'deepseek',
      selectedProviderId: 'deepseek',
      currentModel: 'deepseek-v4-pro',
      modelId: 'deepseek-v4-pro'
    })).toBe(true)
    expect(composerModelMenuItemSelected({
      groupProviderId: 'custom-provider-3',
      selectedProviderId: 'deepseek',
      currentModel: 'deepseek-v4-pro',
      modelId: 'deepseek-v4-pro'
    })).toBe(false)
  })

  it('filters provider model ids by substring without changing the empty query list', () => {
    const modelIds = [
      'deepseek-v4-pro',
      'MiniMax-M2',
      'moonshot-v1-128k'
    ]

    expect(filterComposerModelIds(modelIds, '')).toEqual(modelIds)
    expect(filterComposerModelIds(modelIds, 'max')).toEqual(['MiniMax-M2'])
    expect(filterComposerModelIds(modelIds, '128K')).toEqual(['moonshot-v1-128k'])
  })

  it('keeps the reasoning strength visible in the model control', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'auto',
        composerPickList: ['auto', 'deepseek-v4-pro'],
        composerModelGroups: [DEEPSEEK_PROVIDER_GROUP],
        composerReasoningEffort: 'high',
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined
      })
    )

    expect(html).toContain('Auto')
    expect(html).toContain('High')
  })

  it('renders Code split controls as borderless model and reasoning triggers', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        controlVariant: 'split',
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['deepseek-v4-pro'],
        composerModelGroups: [DEEPSEEK_PROVIDER_GROUP],
        composerReasoningEffort: 'max',
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined
      })
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Reasoning')
    expect(html).toContain('Ultra')
    expect(html).toContain('aria-label="Model: DeepSeek / deepseek-v4-pro"')
    expect(html).toContain('aria-label="Reasoning: Ultra"')
    expect(html).not.toContain('Model and reasoning settings')
  })

  it('shows an active Fast toggle for an eligible multi-account Codex subscription', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        controlVariant: 'split',
        composerModel: 'gpt-5.4',
        composerProviderId: 'codex-2',
        composerPickList: ['gpt-5.4'],
        composerModelGroups: [CODEX_PROVIDER_GROUP],
        composerReasoningEffort: 'high',
        composerFastMode: true,
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined,
        onComposerFastModeChange: () => undefined
      })
    )

    expect(html).toContain('aria-label="Fast mode on"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('lucide-zap')
  })

  it('uses the shared preset icon in the current model control and provider menu', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', {
      innerHeight: 800,
      innerWidth: 1200,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    let renderer: ReturnType<typeof createRenderer> | undefined
    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposerModelPicker, {
          compact: false,
          mode: 'select',
          composerModel: 'gpt-5.4',
          composerProviderId: 'codex-2',
          composerPickList: ['gpt-5.4'],
          composerModelGroups: [CODEX_PROVIDER_GROUP],
          canChangeModel: true,
          onComposerModelChange: () => undefined
        }))
      })
      const trigger = renderer!.root.findAllByType('button')
        .find((button) => button.props['aria-haspopup'] === 'menu')
      expect(trigger).toBeTruthy()
      await act(async () => trigger!.props.onClick())

      expect(renderer!.root.findAllByProps({ 'data-provider-icon': 'codex' }).length)
        .toBeGreaterThanOrEqual(2)
    } finally {
      if (renderer) await act(async () => renderer!.unmount())
      vi.unstubAllGlobals()
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    }
  })

  it('hides Fast for Codex subscription models that do not advertise priority', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        controlVariant: 'split',
        composerModel: 'gpt-5.4-mini',
        composerProviderId: 'codex-2',
        composerPickList: ['gpt-5.4-mini'],
        composerModelGroups: [CODEX_PROVIDER_GROUP],
        composerFastMode: true,
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onComposerFastModeChange: () => undefined
      })
    )

    expect(html).not.toContain('Fast mode on')
    expect(html).not.toContain('lucide-zap')
  })

  it('keeps provider setup reachable when no chat providers are available', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'auto',
        composerPickList: ['auto'],
        composerModelGroups: [],
        canChangeModel: false,
        onComposerModelChange: () => undefined,
        onConfigureProviders: () => undefined
      })
    )

    expect(html).toContain('Set up provider')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('disabled=""')
  })

  it('does not treat default fallback models as configured providers', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        composerModelGroups: [],
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onConfigureProviders: () => undefined
      })
    )

    expect(html).toContain('Set up provider')
    expect(html).not.toContain('deepseek-v4-pro')
  })
})
