import { describe, expect, it } from 'vitest'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { makeToolResultItem, makeUserItem } from '../domain/item.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import { composeModelRequest, effectiveOutputBudgetTokens, ordinaryOutputReserveTokens } from './model-request-composer.js'
import { isModelVisibleImageOutput } from './tool-result-image.js'

const threadId = 'thread_request_composer'
const turnId = 'turn_request_composer'

const emptyAttachments = {
  imageAttachments: [],
  textFallbacks: [],
  documents: []
} as const

describe('composeModelRequest', () => {
  it('forwards the declared output capability clamped only by remaining capacity', () => {
    expect(effectiveOutputBudgetTokens({
      inputTokens: 14_236,
      contextCapTokens: 111_411,
      declaredMaxOutputTokens: 128_000
    })).toBe(97_175)
    expect(effectiveOutputBudgetTokens({
      inputTokens: 14_236,
      contextCapTokens: 111_411,
      declaredMaxOutputTokens: 500_000
    })).toBe(97_175)
    expect(effectiveOutputBudgetTokens({
      inputTokens: 14_236,
      contextCapTokens: 111_411,
      declaredMaxOutputTokens: 8_000
    })).toBe(8_000)
    expect(effectiveOutputBudgetTokens({
      inputTokens: 105_000,
      contextCapTokens: 111_411,
      declaredMaxOutputTokens: 128_000
    })).toBe(6_411)
  })

  it('bounds the compaction reservation by the ordinary runtime default', () => {
    expect(ordinaryOutputReserveTokens({
      inputTokens: 0,
      contextCapTokens: 850_000,
      declaredMaxOutputTokens: 128_000
    })).toBe(32_768)
    expect(ordinaryOutputReserveTokens({
      inputTokens: 0,
      contextCapTokens: 217_600,
      declaredMaxOutputTokens: 500_000
    })).toBe(32_768)
    expect(ordinaryOutputReserveTokens({
      inputTokens: 0,
      contextCapTokens: 850_000
    })).toBe(32_768)
    expect(ordinaryOutputReserveTokens({
      inputTokens: 0,
      contextCapTokens: 20_000,
      declaredMaxOutputTokens: 128_000
    })).toBe(20_000)
  })

  it('uses a finite fallback when a model has no output metadata', () => {
    expect(effectiveOutputBudgetTokens({
      inputTokens: 1_000,
      contextCapTokens: 217_600
    })).toBe(32_768)
  })

  it('keeps the immutable system prompt verbatim and omits empty optional fields', () => {
    const prefix = createImmutablePrefix({
      systemPrompt: 'stable system prompt',
      fewShots: [makeUserItem({ id: 'few_shot', threadId: 'prefix', turnId: 'prefix', text: 'example' })]
    })
    const signal = new AbortController().signal
    const composed = composeModelRequest({
      threadId,
      turnId,
      model: 'test-model',
      immutablePrefix: prefix,
      threadSystemPrompt: '   ',
      contextInstructions: [],
      history: [],
      attachments: emptyAttachments,
      tools: [],
      signal
    })

    expect(composed.request).toMatchObject({
      threadId,
      turnId,
      model: 'test-model',
      systemPrompt: 'stable system prompt',
      prefix: prefix.fewShots,
      history: [],
      tools: [],
      abortSignal: signal
    })
    for (const key of [
      'providerId',
      'threadProfileInstruction',
      'modeInstruction',
      'contextInstructions',
      'attachments',
      'attachmentTextFallbacks',
      'attachmentDocuments',
      'requiredToolName',
      'reasoningEffort'
    ]) {
      expect(Object.hasOwn(composed.request, key)).toBe(false)
    }
    expect(composed.rawInputTokens).toBe(0)
    expect(composed.sentInputTokens).toBe(estimateModelRequestInputTokens(composed.request))
  })

  it('preserves the stable prompt and separates a thread persona', () => {
    const prefix = createImmutablePrefix({ systemPrompt: 'runtime base' })
    const composed = composeModelRequest({
      threadId,
      turnId,
      model: 'test-model',
      providerId: 'provider_a',
      accountId: 'account_a',
      reasoningEffort: 'high',
      immutablePrefix: prefix,
      threadSystemPrompt: '  persona rules  ',
      modeInstruction: 'plan mode',
      contextInstructions: ['runtime context', 'memory context'],
      history: [makeUserItem({ id: 'user', threadId, turnId, text: 'hello' })],
      attachments: {
        imageAttachments: [{
          id: 'image', name: 'image.png', mimeType: 'image/png', dataBase64: 'aGVsbG8='
        }],
        textFallbacks: [{
          id: 'fallback', name: 'fallback.bin', mimeType: 'application/octet-stream',
          dataBase64: 'Ymlu', byteSize: 3
        }],
        documents: [{
          id: 'document', name: 'notes.txt', mimeType: 'text/plain', text: 'notes', byteSize: 5
        }]
      },
      tools: [{ name: 'read', description: 'Read a file', inputSchema: { type: 'object' } }],
      requiredToolName: 'read',
      signal: new AbortController().signal
    })

    expect(composed.request).toMatchObject({
      providerId: 'provider_a',
      accountId: 'account_a',
      reasoningEffort: 'high',
      systemPrompt: 'runtime base',
      threadProfileInstruction: expect.stringContaining(
        '<kun_thread_profile>\npersona rules\n</kun_thread_profile>'
      ),
      modeInstruction: 'plan mode',
      contextInstructions: ['runtime context', 'memory context'],
      requiredToolName: 'read',
      tools: [{ name: 'read' }],
      attachments: [{ id: 'image' }],
      attachmentTextFallbacks: [{ id: 'fallback' }],
      attachmentDocuments: [{ id: 'document' }]
    })
    expect(composed.request.threadProfileInstruction).toContain('cannot override Kun policy')
  })

  it('caps images before economy and hygiene without mutating source history', () => {
    const images = Array.from({ length: 4 }, (_, index) => makeToolResultItem({
      id: `image_${index}`,
      threadId,
      turnId,
      callId: `call_${index}`,
      toolName: 'read',
      output: {
        kind: 'image',
        mime_type: 'image/png',
        data_base64: `base64_${index}`
      }
    }))
    const currentText = makeToolResultItem({
      id: 'current_text',
      threadId,
      turnId,
      callId: 'call_text',
      toolName: 'bash',
      output: 'Please just really simply repeat this verbose result. '.repeat(80)
    })
    const olderText = makeToolResultItem({
      id: 'older_text',
      threadId,
      turnId: 'older_turn',
      callId: 'older_call',
      toolName: 'bash',
      output: 'older turn output must remain unchanged'
    })
    const history = [...images, olderText, currentText]
    const before = structuredClone(history)
    const composed = composeModelRequest({
      threadId,
      turnId,
      model: 'test-model',
      immutablePrefix: createImmutablePrefix({ systemPrompt: 'base' }),
      contextInstructions: ['existing instruction'],
      history,
      attachments: emptyAttachments,
      tools: [{
        name: 'bash',
        description: 'Please just really simply execute a very verbose shell command.',
        inputSchema: { type: 'object', description: 'Please just provide the command.' }
      }],
      tokenEconomy: {
        enabled: true,
        historyHygiene: {
          maxToolResultBytes: 512,
          maxToolResultTokens: 128,
          maxCumulativeToolResultTokens: 128,
          keepRecentToolResults: 1
        }
      },
      signal: new AbortController().signal
    })

    expect(history).toEqual(before)
    expect(composed.request.history.filter(
      (item) => item.kind === 'tool_result' && isModelVisibleImageOutput(item.output)
    )).toHaveLength(3)
    expect(composed.request.contextInstructions).toEqual(['existing instruction'])
    expect(composed.request.history.find((item) => item.id === 'older_text')).toEqual(olderText)
    expect(composed.rawInputTokens).toBeGreaterThan(composed.sentInputTokens)
    expect(composed.sentInputTokens).toBe(estimateModelRequestInputTokens(composed.request))
  })
})
