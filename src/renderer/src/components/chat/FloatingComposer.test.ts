import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
  shouldCaptureFileMentionCommitKey,
  shouldShowGoalFloater,
  shouldSurfaceComposerUserInput
} from './FloatingComposer'
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
  calculateExecutionMenuPlacement
} from './FloatingComposerExecutionPicker'
import { FloatingComposerQueuedMessages } from './FloatingComposerQueuedMessages'
import { getGoalPanelDraftObjective } from './floating-composer-commands'
import { useChatStore } from '../../store/chat-store'
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

const DEEPSEEK_PROVIDER_GROUP = {
  providerId: 'deepseek',
  label: 'DeepSeek',
  modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash']
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
      expect(html).toContain('Only plain-text follow-ups can guide')
      expect(html).toContain('disabled=""')
      expect(html).not.toContain('These messages will send automatically')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
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

describe('FloatingComposer file references', () => {
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
    expect(html).toContain('aria-label="Model"')
    expect(html).toContain('aria-label="Reasoning: Ultra"')
    expect(html).not.toContain('Model and reasoning settings')
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

describe('FloatingComposer image transfer helpers', () => {
  it('extracts image files from clipboard or drop payloads', () => {
    const screenshot = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const pastedWebp = new File([new Uint8Array([4])], '', { type: 'image/webp' })
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const source = {
      items: {
        length: 3,
        0: { kind: 'file', type: 'image/webp', getAsFile: () => pastedWebp },
        1: { kind: 'file', type: 'text/plain', getAsFile: () => notes },
        2: { kind: 'string', type: 'text/plain', getAsFile: () => null }
      },
      files: {
        length: 2,
        0: screenshot,
        1: notes
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([pastedWebp, screenshot])
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('deduplicates files exposed through both transfer item and file lists', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 1,
        0: screenshot
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([screenshot])
  })

  it('keeps clipboard item MIME hints when pasted image files omit their own type', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot', { type: '' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 0
      }
    }

    const [file] = imageFilesFromTransfer(source)

    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/png')
    expect(file?.name).toBe('shot')
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('routes pasted image files through the clipboard bridge when available', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const preventDefault = vi.fn()
    const onPickAttachments = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => '',
        items: {
          length: 1,
          0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        }
      },
      preventDefault,
      onPickAttachments,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPickAttachments).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: false })
  })

  it('still uses the attachment picker for pasted image files when the clipboard bridge is unavailable', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const preventDefault = vi.fn()
    const onPickAttachments = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => '',
        items: {
          length: 1,
          0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        }
      },
      preventDefault,
      onPickAttachments
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPickAttachments).toHaveBeenCalledWith([screenshot])
  })

  it('does not intercept ordinary text paste', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: (format) => format === 'text/plain' ? 'hello' : ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: true })
  })

  it('falls back to the Electron clipboard image bridge when files are unavailable', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: false })
  })
})

describe('FloatingComposer capability controls', () => {
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
            sandboxMode: 'danger-full-access'
          },
          onChange: () => undefined
        })
      )

      expect(html).toContain('完全访问')
      expect(html).not.toContain('>审批<')
      expect(html).not.toContain('>权限<')
      expect(html).toContain('aria-label="工具权限"')
      expect(html).toContain('lucide-lock-keyhole-open')
      expect(html).not.toContain('Full access')
      expect(html).not.toContain('Auto')
      expect(html).not.toContain('Bypass')
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })

  it('renders the workspace-write permission mode in the execution picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerExecutionPicker, {
        value: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write'
        },
        onChange: () => undefined
      })
    )

    expect(html).toContain('Ask in workspace')
    expect(html).toContain('Asks before workspace file changes')
    expect(html).toContain('aria-label="Tool permission"')
    expect(html).toContain('lucide-folder-pen')
  })

  it('renders the trusted workspace permission mode in the execution picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerExecutionPicker, {
        value: {
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write'
        },
        onChange: () => undefined
      })
    )

    expect(html).toContain('Trusted workspace')
    expect(html).toContain('Workspace file changes run without prompts')
    expect(html).toContain('aria-label="Tool permission"')
    expect(html).toContain('lucide-shield-check')
  })

  it('renders the sensitive-ask permission mode in the execution picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerExecutionPicker, {
        value: {
          approvalPolicy: 'untrusted',
          sandboxMode: 'danger-full-access'
        },
        onChange: () => undefined
      })
    )

    expect(html).toContain('Sensitive ask')
    expect(html).toContain('Ordinary reads can run automatically')
    expect(html).toContain('aria-label="Tool permission"')
    expect(html).toContain('lucide-shield-question')
  })

  it('renders the always-ask permission label in Chinese as 永远询问', async () => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage('zh')

    try {
      const html = renderToStaticMarkup(
        createElement(FloatingComposerExecutionPicker, {
          value: {
            approvalPolicy: 'always',
            sandboxMode: 'danger-full-access'
          },
          onChange: () => undefined
        })
      )

      expect(html).toContain('永远询问')
      expect(html).toContain('每次工具调用都要你确认')
      expect(html).toContain('lucide-hand')
      expect(html).not.toContain('永远咨询')
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
    expect(html).toContain('Stop')
    const modelTrigger = html.match(/<button[^>]*aria-label="Model"[^>]*>/)?.[0]
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
    expect(html).toContain('title="Plan"')
    expect(html).toContain('>Plan</span>')
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
          sandboxMode: 'danger-full-access'
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

  it('renders a changed-file review card above the input', () => {
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
        webAccessAvailable: false,
        changedFiles: [
          { path: 'src/a.ts', added: 3, removed: 1 },
          { path: 'src/b.ts', added: 2, removed: 4 }
        ],
        changedFileStats: { added: 5, removed: 5 },
        onOpenChanges: () => undefined,
        onReviewChanges: () => undefined
      })
    )

    expect(html).toContain('2 files changed')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('+5')
    expect(html).toContain('-5')
    expect(html).toContain('Preview')
    expect(html).toContain('Review')
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
