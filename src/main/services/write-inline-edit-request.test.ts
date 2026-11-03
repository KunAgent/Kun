import { describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings } from '../../shared/app-settings-normalize'
import type { AppSettingsV1 } from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import type { RuntimeModelExecutor } from './runtime-model-requests'
import { configureRuntimeModelExecutor } from './runtime-model-requests'
import { requestWriteInlineCompletion } from './write-inline-completion-request'

describe('explicit selection rewrite requests', () => {
  it('uses the runtime chat path with an edit-only prompt even when automatic completion is disabled', async () => {
    const settings = normalizeAppSettings({ version: 1 } as AppSettingsV1)
    settings.write.inlineCompletion.enabled = false
    settings.write.inlineCompletion.retrievalEnabled = false
    const executor = vi.fn<RuntimeModelExecutor>(async () => ({ ok: true as const, text: '<<<EDIT\nClearer wording.\n>>>' }))
    const cleanup = configureRuntimeModelExecutor(executor)
    try {
      const original = 'Original wording.'
      const request: WriteInlineCompletionRequest = {
        mode: 'edit', prefix: 'Before\n', suffix: '\nAfter', cursor: { line: 2, column: 0 },
        context: { language: 'markdown', currentLinePrefix: original, currentLineSuffix: '', previousLine: 'Before',
          previousNonEmptyLine: 'Before', nextLine: 'After', indentation: '',
          signals: { list: false, quote: false, heading: false, table: false, atLineEnd: false,
            endsWithSentencePunctuation: false, previousLineEndsWithSentencePunctuation: false,
            prefersNewLineCompletion: false, paragraphBreakOpportunity: false } },
        policy: { name: 'selection-edit', instruction: 'Polish', acceptanceCriteria: [], rejectionCriteria: [] },
        preview: { local: original, documentTail: 'Before' },
        editCandidate: { kind: 'selection', from: 7, to: 7 + original.length, original, selectedText: original,
          startLine: 2, endLine: 2, startColumn: 1, endColumn: original.length }
      }
      const result = await requestWriteInlineCompletion(settings, request)
      expect(result).toMatchObject({ ok: true, action: { kind: 'edit', replacement: 'Clearer wording.' } })
      const sent = executor.mock.calls[0][0] as unknown as { messages: Array<{ content: string }>; fim?: unknown }
      expect(sent.fim).toBeUndefined()
      const prompt = sent.messages.map((message) => message.content).join('\n')
      expect(prompt).toContain('Always perform the requested edit')
      expect(prompt).not.toContain('If neither action is useful')
      expect(prompt).toContain('Original wording.')
      expect(prompt).toContain('PREFIX and SUFFIX are read-only context')
    } finally { cleanup() }
  })
})
