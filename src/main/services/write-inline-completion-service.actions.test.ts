import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings, defaultRemoteAccessSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import {
  buildWriteInlineCompletionPrompt,
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  parseWriteInlineAction,
  requestWriteInlineCompletion
} from './write-inline-completion-service'
import { clearWriteRetrievalCache } from './write-retrieval-service'

function createSettings(patch: Partial<AppSettingsV1['write']['inlineCompletion']> = {}): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'sk-test'
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: {
      enabled: true,
      retentionDays: 2
    },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: {
      ...write,
      inlineCompletion: {
        ...write.inlineCompletion,
        ...patch
      }
    },
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    remote: defaultRemoteAccessSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: [],
    claw: defaultClawSettings()
  }
}

function createRequest(): WriteInlineCompletionRequest {
  return {
    prefix: '# Draft\n\nThis is',
    suffix: ' a test.',
    currentFilePath: '/tmp/workspace/draft.md',
    cursor: {
      line: 3,
      column: 7
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'This is',
      currentLineSuffix: ' a test.',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: false,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'This is',
      documentTail: '# Draft This is'
    },
    model: 'deepseek-v4-flash'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearWriteRetrievalCache()
  clearWriteInlineCompletionDebugEntries()
})

describe('parseWriteInlineAction', () => {
  it('parses TextIDE-style marked short, long, and edit blocks', () => {
    expect(parseWriteInlineAction('<<<SHORT\n next words\n>>>')).toEqual({
      kind: 'short',
      text: ' next words'
    })
    expect(parseWriteInlineAction('<<<LONG\n\nA fuller continuation.\n>>>')).toEqual({
      kind: 'long',
      text: '\nA fuller continuation.'
    })
    expect(parseWriteInlineAction('<<<EDIT\nWrite mode\n>>>', {
      editTarget: {
        from: 9,
        to: 21,
        original: 'DeepSeek GUI',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Write mode',
      from: 9,
      to: 21,
      original: 'DeepSeek GUI',
      scopeKind: 'selection'
    })
  })

  it('suppresses echoed boundary-marker prompts', () => {
    expect(parseWriteInlineAction('<<<PREFIX\nThis is\n>>>\n<<<SUFFIX\n a test.\n>>>')).toEqual({
      kind: 'short',
      text: ''
    })
  })

  it('parses JSON action payloads', () => {
    expect(parseWriteInlineAction(JSON.stringify({ kind: 'long', text: 'Continue the paragraph.' }))).toEqual({
      kind: 'long',
      text: 'Continue the paragraph.'
    })
    expect(parseWriteInlineAction(JSON.stringify({ action: 'edit', replacement: 'Rewrite locally.' }), {
      editTarget: {
        from: 3,
        to: 11,
        original: 'Old text',
        scopeKind: 'paragraph'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Rewrite locally.',
      from: 3,
      to: 11,
      original: 'Old text',
      scopeKind: 'paragraph'
    })
  })

  it('parses XML-style action wrappers', () => {
    expect(parseWriteInlineAction('<short>next words</short>')).toEqual({
      kind: 'short',
      text: 'next words'
    })
    expect(parseWriteInlineAction('<long>Two sentences.\nMaybe three.</long>')).toEqual({
      kind: 'long',
      text: 'Two sentences.\nMaybe three.'
    })
    expect(parseWriteInlineAction('<edit>Replace this scope</edit>', {
      editTarget: {
        from: 12,
        to: 20,
        original: 'old value',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Replace this scope',
      from: 12,
      to: 20,
      original: 'old value',
      scopeKind: 'selection'
    })
  })

  it('parses labeled plain-text fallbacks', () => {
    expect(parseWriteInlineAction('completion: next sentence')).toEqual({
      kind: 'short',
      text: 'next sentence'
    })
    expect(parseWriteInlineAction('long: A fuller continuation.')).toEqual({
      kind: 'long',
      text: 'A fuller continuation.'
    })
    expect(parseWriteInlineAction('edit: Rewrite this block', {
      editTarget: {
        from: 1,
        to: 4,
        original: 'old',
        scopeKind: 'paragraph'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Rewrite this block',
      from: 1,
      to: 4,
      original: 'old',
      scopeKind: 'paragraph'
    })
  })

  it('falls back to the requested mode for unstructured plain text', () => {
    expect(parseWriteInlineAction('Raw continuation text')).toEqual({
      kind: 'short',
      text: 'Raw continuation text'
    })
    expect(parseWriteInlineAction('Raw long continuation', { fallbackKind: 'long' })).toEqual({
      kind: 'long',
      text: 'Raw long continuation'
    })
    expect(parseWriteInlineAction('Raw edit replacement', {
      fallbackKind: 'edit',
      editTarget: {
        from: 8,
        to: 15,
        original: 'old text',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Raw edit replacement',
      from: 8,
      to: 15,
      original: 'old text',
      scopeKind: 'selection'
    })
  })

  it('returns an empty completion for a malformed marker skeleton instead of leaking markers', () => {
    // Regression: a degenerate single-line skeleton used to fall through to the
    // plain-text fallback and render ">>> <<<LONG >>> <<<EDIT" as ghost text.
    expect(parseWriteInlineAction('>>> <<<LONG >>> <<<EDIT')).toEqual({
      kind: 'short',
      text: ''
    })
    expect(parseWriteInlineAction('<<<SHORT >>> <<<LONG >>> <<<EDIT >>>', { fallbackKind: 'long' })).toEqual({
      kind: 'long',
      text: ''
    })
  })

  it('returns an empty completion when the model parrots the protocol template', () => {
    const template = [
      '<<<SHORT',
      'short text to insert at the cursor',
      '>>>',
      '<<<LONG',
      'longer continuation to insert at the cursor',
      '>>>',
      '<<<EDIT',
      'replacement text for the editable local scope',
      '>>>'
    ].join('\n')
    expect(parseWriteInlineAction(template)).toEqual({ kind: 'short', text: '' })
  })

  it('parses same-line marked blocks', () => {
    expect(parseWriteInlineAction('<<<SHORT next words >>>')).toEqual({
      kind: 'short',
      text: 'next words'
    })
  })

  it('prefers the first non-empty block when an earlier block is empty', () => {
    expect(parseWriteInlineAction('<<<SHORT\n>>>\n<<<LONG\nA fuller continuation.\n>>>')).toEqual({
      kind: 'long',
      text: 'A fuller continuation.'
    })
  })

  it('extracts a block that dropped its closing marker without swallowing the next marker', () => {
    expect(parseWriteInlineAction('<<<SHORT\nnext words\n<<<EDIT\nignored\n>>>')).toEqual({
      kind: 'short',
      text: 'next words'
    })
  })

  it('keeps plain text that legitimately contains >>> when no protocol marker is present', () => {
    expect(parseWriteInlineAction('>>> a Python prompt')).toEqual({
      kind: 'short',
      text: '>>> a Python prompt'
    })
  })
})
