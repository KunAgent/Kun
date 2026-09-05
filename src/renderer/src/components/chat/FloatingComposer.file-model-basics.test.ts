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
  formatComposerKnowledgeBaseMentionToken,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isFileWithinDirectory,
  removeComposerFileMentionToken,
  replaceComposerMentionWithToken,
  replaceFileMentionInInput,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { FloatingComposerFileMentionMenu } from './FloatingComposerFileMentionMenu'
import { filterKnowledgeBaseMentionSuggestions } from './use-composer-file-mentions'
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

describe('FloatingComposer file references', () => {
  it('formats and inserts knowledge-base mentions without creating file paths', () => {
    const token = formatComposerKnowledgeBaseMentionToken('Product "Docs" \\ 2026')
    expect(token).toBe('@kb:"Product \\"Docs\\" \\\\ 2026"')
    const mention = getFileMentionAtCursor('check @prod', 'check @prod'.length)
    expect(mention).not.toBeNull()
    expect(replaceComposerMentionWithToken('check @prod', mention!, token)).toEqual({
      input: `check ${token} `,
      cursor: `check ${token} `.length
    })
  })

  it('filters mounted knowledge bases by name and carries index status', () => {
    const mounts = [{
      id: 'kb_docs',
      root: '/private/product-docs',
      name: 'Product Docs',
      source: 'write-workspace' as const,
      access: 'read-only' as const
    }, {
      id: 'kb_notes',
      root: '/private/notes',
      name: 'Team Notes',
      source: 'write-workspace' as const,
      access: 'read-only' as const
    }]
    expect(filterKnowledgeBaseMentionSuggestions(mounts, [{
      id: 'kb_docs', state: 'ready', documentCount: 3, nodeCount: 12
    }], 'product')).toEqual([{
      kind: 'knowledge-base', id: 'kb_docs', name: 'Product Docs', status: 'ready'
    }])
  })

  it('renders knowledge bases before file references without exposing mount roots', () => {
    const knowledge = {
      kind: 'knowledge-base' as const,
      id: 'kb_docs',
      name: 'Product Docs',
      status: 'ready' as const
    }
    const html = renderToStaticMarkup(createElement(FloatingComposerFileMentionMenu, {
      suggestions: [knowledge, {
        kind: 'file-reference' as const,
        reference: { path: '/repo/README.md', relativePath: 'README.md', name: 'README.md' }
      }],
      loading: false,
      selectedIndex: 0,
      highlighted: knowledge,
      hasMountedKnowledgeBases: true,
      onSelect: vi.fn()
    }))
    expect(html).toContain('Product Docs')
    expect(html).toContain('@kb:&quot;Product Docs&quot;')
    expect(html.indexOf('Product Docs')).toBeLessThan(html.indexOf('README.md'))
    expect(html).not.toContain('/private/product-docs')
  })

  it('captures file mention commit keys while the menu is active before candidates load', () => {
    expect(shouldCaptureFileMentionCommitKey({
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false
    })).toBe(true)
    expect(shouldCaptureFileMentionCommitKey({
      key: 'Tab',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false
    })).toBe(true)
    expect(shouldCaptureFileMentionCommitKey({
      key: 'Enter',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false
    })).toBe(false)
    expect(shouldCaptureFileMentionCommitKey({
      key: 'Enter',
      shiftKey: false,
      metaKey: true,
      ctrlKey: false
    })).toBe(false)
  })

  it('parses @ file mention queries at the current cursor', () => {
    expect(getFileMentionAtCursor('please inspect @src/ren', 'please inspect @src/ren'.length)).toEqual({
      start: 15,
      end: 23,
      query: 'src/ren',
      quoted: false
    })
    expect(getFileMentionAtCursor('compare @"docs/product plan', 'compare @"docs/product plan'.length)).toEqual({
      start: 8,
      end: 27,
      query: 'docs/product plan',
      quoted: true
    })
    expect(getFileMentionAtCursor('email test@example.com', 'email test@example.com'.length)).toBeNull()
  })

  it('formats, inserts, removes, and ranks composer file references', () => {
    const files = [
      { path: '/repo/src/App.tsx', relativePath: 'src/App.tsx', name: 'App.tsx' },
      { path: '/repo/package.json', relativePath: 'package.json', name: 'package.json' },
      { path: '/repo/docs/product plan.md', relativePath: 'docs/product plan.md', name: 'product plan.md' }
    ]

    expect(formatComposerFileMentionToken('docs/product plan.md')).toBe('@"docs/product plan.md"')
    expect(filterWorkspaceFileMentionSuggestions(files, 'pack')).toEqual([files[1]])

    const mention = getFileMentionAtCursor('open @doc', 'open @doc'.length)
    expect(mention).not.toBeNull()
    const replaced = replaceFileMentionInInput('open @doc', mention!, files[2])
    expect(replaced.input).toBe('open @"docs/product plan.md" ')
    expect(removeComposerFileMentionToken(replaced.input, files[2].relativePath)).toBe('open')
  })

  it('formats, inserts, and removes directory mentions with a trailing slash', () => {
    expect(formatComposerFileMentionToken('src/components', true)).toBe('@src/components/')
    expect(formatComposerFileMentionToken('docs/product specs', true)).toBe('@"docs/product specs/"')

    const mention = getFileMentionAtCursor('check @src/comp', 'check @src/comp'.length)
    expect(mention).not.toBeNull()
    const replaced = replaceFileMentionInInput('check @src/comp', mention!, {
      relativePath: 'src/components',
      type: 'directory'
    })
    expect(replaced.input).toBe('check @src/components/ ')
    expect(removeComposerFileMentionToken(replaced.input, 'src/components', true)).toBe('check')
  })

  it('keeps a nested file mention intact when removing its parent directory mention', () => {
    const input = 'review @src/ and @src/App.tsx now'
    expect(removeComposerFileMentionToken(input, 'src', true)).toBe('review and @src/App.tsx now')
    // …even when the nested file mention appears before the standalone directory token.
    const reordered = 'review @src/App.tsx and @src/ now'
    expect(removeComposerFileMentionToken(reordered, 'src', true)).toBe('review @src/App.tsx and now')
  })

  it('detects exact inserted mention tokens without matching path prefixes', () => {
    expect(hasComposerFileMentionToken('review @src/renderer/src/App.tsx now', 'src/renderer/src/App.tsx')).toBe(true)
    expect(hasComposerFileMentionToken('review @"docs/product plan.md" now', 'docs/product plan.md')).toBe(true)
    expect(hasComposerFileMentionToken('review @src/ now', 'src', true)).toBe(true)
    expect(hasComposerFileMentionToken('review @src/App.tsx now', 'src', true)).toBe(false)
    expect(hasComposerFileMentionToken('email test@src/App.tsx now', 'src/App.tsx')).toBe(false)
  })

  it('ranks directories alongside files and favors them for trailing-slash queries', () => {
    const entries: ComposerFileReference[] = [
      { path: '/repo/src', relativePath: 'src', name: 'src', type: 'directory' },
      { path: '/repo/src/App.tsx', relativePath: 'src/App.tsx', name: 'App.tsx', type: 'file' },
      { path: '/repo/src/index.ts', relativePath: 'src/index.ts', name: 'index.ts', type: 'file' }
    ]
    const suggestions = filterWorkspaceFileMentionSuggestions(entries, 'src/')
    expect(suggestions[0]).toEqual(entries[0])
    expect(suggestions.map((entry) => entry.relativePath)).toContain('src/App.tsx')
  })

  it('filters path-like @ queries and excludes already selected duplicate paths', () => {
    const entries: ComposerFileReference[] = [
      { path: '/repo/src/renderer', relativePath: 'src/renderer', name: 'renderer', type: 'directory' },
      { path: '/repo/src/renderer/src/FloatingComposer.tsx', relativePath: 'src/renderer/src/FloatingComposer.tsx', name: 'FloatingComposer.tsx', type: 'file' },
      { path: '/repo/packages/ui/src/FloatingComposer.tsx', relativePath: 'packages/ui/src/FloatingComposer.tsx', name: 'FloatingComposer.tsx', type: 'file' }
    ]

    const suggestions = filterWorkspaceFileMentionSuggestions(entries, 'src/ren', [entries[1]!])

    expect(suggestions.map((entry) => entry.relativePath)).toEqual(['src/renderer'])
  })

  it('lists every indexed file beneath a referenced directory', () => {
    const files: ComposerFileReference[] = [
      { path: '/repo/src/App.tsx', relativePath: 'src/App.tsx', name: 'App.tsx', type: 'file' },
      { path: '/repo/src/lib/util.ts', relativePath: 'src/lib/util.ts', name: 'util.ts', type: 'file' },
      { path: '/repo/docs/readme.md', relativePath: 'docs/readme.md', name: 'readme.md', type: 'file' }
    ]
    expect(filesUnderDirectory(files, 'src').map((file) => file.relativePath)).toEqual([
      'src/App.tsx',
      'src/lib/util.ts'
    ])
    expect(isFileWithinDirectory('src/App.tsx', 'src')).toBe(true)
    expect(isFileWithinDirectory('srcabc/App.tsx', 'src')).toBe(false)
    expect(isFileWithinDirectory('docs/readme.md', 'src')).toBe(false)
  })

  it('builds a compact prompt from referenced workspace files', () => {
    const prompt = buildComposerFileContextPrompt('summarize this', [{
      relativePath: 'src/App.tsx',
      content: 'export function App() {}',
      truncated: true
    }])

    expect(prompt).toContain('<workspace_file path="src/App.tsx" truncated="true">')
    expect(prompt).toContain('export function App() {}')
    expect(prompt).toContain('User request:\nsummarize this')
  })
})

describe('FloatingComposer model controls', () => {
  it('passes explicit reasoning choices through to the runtime', () => {
    expect(composerReasoningEffortRequestValue('off')).toBe('off')
    expect(composerReasoningEffortRequestValue('low')).toBe('low')
    expect(composerReasoningEffortRequestValue('max')).toBe('max')
  })

  it('falls back to the model default when the selected model does not support the current effort', () => {
    const profile = {
      reasoning: {
        supportedEfforts: ['off', 'low', 'medium', 'high'],
        defaultEffort: 'high',
        requestProtocol: 'mimo-chat-completions'
      }
    } satisfies NonNullable<Parameters<typeof normalizeComposerReasoningEffort>[1]>

    expect(normalizeComposerReasoningEffort('max', profile)).toBe('high')
    expect(normalizeComposerReasoningEffort('auto', profile)).toBe('high')
    expect(normalizeComposerReasoningEffort('medium', profile)).toBe('medium')
  })

  it('does not reinterpret an unsupported low effort as off', () => {
    expect(normalizeComposerReasoningEffort('low', {
      reasoning: {
        supportedEfforts: ['off', 'medium', 'auto'],
        defaultEffort: 'medium',
        requestProtocol: 'openai-responses'
      }
    })).toBe('medium')
  })

  it('uses the legacy effort set when no model reasoning profile is available', () => {
    expect(normalizeComposerReasoningEffort('auto')).toBe('max')
    expect(normalizeComposerReasoningEffort('medium')).toBe('medium')
  })

  it('enables ambient energy motion only for the deeper semantic efforts', () => {
    expect(composerReasoningEffortHasEnergyMotion('off')).toBe(false)
    expect(composerReasoningEffortHasEnergyMotion('low')).toBe(false)
    expect(composerReasoningEffortHasEnergyMotion('medium')).toBe(false)
    expect(composerReasoningEffortHasEnergyMotion('high')).toBe(true)
    expect(composerReasoningEffortHasEnergyMotion('max')).toBe(true)
    expect(composerReasoningEffortHasEnergyMotion('auto')).toBe(true)
  })

  it('orders rail efforts canonically and keeps adaptive at the far-right stop', () => {
    const efforts = orderComposerReasoningRailEfforts(['auto', 'high', 'off', 'high'])

    expect(efforts).toEqual(['off', 'high', 'auto'])
    expect(composerReasoningRailPosition(efforts, 'off')).toBe(0)
    expect(composerReasoningRailPosition(efforts, 'high')).toBe(0.5)
    expect(composerReasoningRailPosition(efforts, 'auto')).toBe(1)
    expect(composerReasoningRailPosition(['auto'], 'auto')).toBe(1)
  })

  it('snaps pointer positions to the nearest supported rail effort', () => {
    const efforts = orderComposerReasoningRailEfforts(['off', 'high', 'max'])

    expect(composerReasoningEffortForRailPosition(efforts, -1)).toBe('off')
    expect(composerReasoningEffortForRailPosition(efforts, 0.49)).toBe('high')
    expect(composerReasoningEffortForRailPosition(efforts, 0.8)).toBe('max')
    expect(composerReasoningEffortForRailPosition(['auto'], 0)).toBe('auto')
  })

  it('maps pointer dragging across the thumb-safe rail range', () => {
    expect(composerReasoningRailPointerPosition(118, 100, 250)).toBe(0)
    expect(composerReasoningRailPointerPosition(225, 100, 250)).toBe(0.5)
    expect(composerReasoningRailPointerPosition(332, 100, 250)).toBe(1)
    expect(composerReasoningRailPointerPosition(80, 100, 250)).toBe(0)
    expect(composerReasoningRailPointerPosition(360, 100, 250)).toBe(1)
    expect(composerReasoningRailPointerPosition(Number.NaN, 100, 250)).toBe(0)
    expect(composerReasoningRailPointerPosition(100, 100, 30)).toBe(0)
  })

  it('moves keyboard input only across supported reasoning stops', () => {
    const efforts = orderComposerReasoningRailEfforts(['auto', 'high', 'off'])

    expect(composerReasoningEffortForRailKey(efforts, 'off', 'ArrowLeft')).toBe('off')
    expect(composerReasoningEffortForRailKey(efforts, 'off', 'ArrowRight')).toBe('high')
    expect(composerReasoningEffortForRailKey(efforts, 'high', 'ArrowRight')).toBe('auto')
    expect(composerReasoningEffortForRailKey(efforts, 'auto', 'ArrowRight')).toBe('auto')
    expect(composerReasoningEffortForRailKey(efforts, 'high', 'Home')).toBe('off')
    expect(composerReasoningEffortForRailKey(efforts, 'off', 'End')).toBe('auto')
    expect(composerReasoningEffortForRailKey(efforts, 'high', 'Enter')).toBeUndefined()
    expect(composerReasoningEffortForRailKey([], 'high', 'ArrowRight')).toBeUndefined()
  })

  it('anchors the model menu to the trigger using the rendered menu height', () => {
    const placement = calculateFloatingMenuPlacement({
      anchorRect: { top: 780, right: 920, bottom: 816 },
      menuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(712)
    expect(placement.top).toBe(633)
  })

  it('keeps the model menu anchored when the app UI is zoomed', () => {
    const placement = calculateFloatingMenuPlacement({
      anchorRect: { top: 624, right: 736, bottom: 652.8 },
      menuHeight: 140,
      viewportHeight: 720,
      viewportWidth: 800,
      coordinateScale: 0.8
    })

    expect(placement.left).toBe(712)
    expect(placement.top).toBe(633)
  })

  it('anchors the Code reasoning popover above its own trigger', () => {
    const placement = calculateFloatingReasoningPopoverPlacement({
      anchorRect: { top: 700, right: 650, bottom: 736, left: 550 },
      popoverHeight: 110,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement).toEqual({ left: 457, top: 578, width: 286 })
  })

  it('keeps the context capacity popover inside the viewport', () => {
    const placement = calculateContextCapacityPopoverPlacement({
      anchorRect: { top: 760, right: 970, bottom: 792 },
      popoverHeight: 252,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(670)
    expect(placement.top).toBe(500)
    expect(placement.width).toBe(300)
  })

  it('keeps the context capacity popover anchored when the app UI is zoomed', () => {
    const placement = calculateContextCapacityPopoverPlacement({
      anchorRect: { top: 608, right: 776, bottom: 633.6 },
      popoverHeight: 252,
      viewportHeight: 720,
      viewportWidth: 800,
      coordinateScale: 0.8
    })

    expect(placement.left).toBe(670)
    expect(placement.top).toBe(500)
    expect(placement.width).toBe(300)
  })

  it('isolates context snapshots from a different thread, model, or provider', () => {
    const snapshot = {
      threadId: 'thr_1',
      model: 'DeepSeek-V4-Pro',
      providerId: 'deepseek',
      stepIndex: 0,
      contextWindowTokens: 256_000,
      softThresholdTokens: 192_000,
      hardThresholdTokens: 217_600,
      estimatedInputTokens: 12_000,
      breakdown: { tools: 3_000, system: 2_000, skills: 1_000, messages: 5_000, other: 1_000 },
      toolCount: 21,
      activeSkillIds: []
    }

    expect(requestContextSnapshotMatchesSelection(snapshot, {
      threadId: 'thr_1',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek'
    })).toBe(true)
    expect(requestContextSnapshotMatchesSelection(snapshot, {
      threadId: 'thr_2',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek'
    })).toBe(false)
    expect(requestContextSnapshotMatchesSelection(snapshot, {
      threadId: 'thr_1',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek'
    })).toBe(false)
    expect(requestContextSnapshotMatchesSelection(snapshot, {
      threadId: 'thr_1',
      model: 'deepseek-v4-pro',
      providerId: 'minimax'
    })).toBe(false)
    expect(requestContextSnapshotMatchesSelection(snapshot, {
      threadId: 'thr_1',
      model: 'auto'
    })).toBe(false)
    expect(requestContextSnapshotMatchesSelection({
      ...snapshot,
      providerId: undefined
    }, {
      threadId: 'thr_1',
      model: 'auto'
    })).toBe(true)
  })

})
