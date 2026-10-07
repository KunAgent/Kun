import { describe, expect, it } from 'vitest'
import {
  makeAssistantReasoningItem,
  makeGoalContextItem,
  makeModelContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../../domain/item.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { projectCompatMessages } from './compat-message-projector.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'
import { COMPAT_HISTORY_CONTEXT } from './compat-request-codecs.js'

const composerContextFixture = {
  schemaVersion: 1 as const,
  id: 'video-selection',
  title: 'Interview selection',
  summary: 'Revision 4 with two selected clips',
  reference: { projectId: 'project-1', selectedItemIds: ['clip-1', 'clip-2'] },
  revision: 4,
  generation: 7,
  attachmentId: `extension-context:${'a'.repeat(64)}`,
  provenance: {
    extensionId: 'acme.video-editor',
    extensionVersion: '1.1.0',
    viewContributionId: 'extension:acme.video-editor/editor',
    workspaceId: 'b'.repeat(64)
  }
}

describe('compat composer context projection', () => {
  it('appends extension context once to USER content and never changes system content', () => {
    const user = makeUserItem({
      id: 'item-user',
      turnId: 'turn-1',
      threadId: 'thread-1',
      text: 'Use the selected clips',
      composerContexts: [composerContextFixture]
    })
    const request: ModelRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      model: 'test-model',
      systemPrompt: 'stable-system-prefix',
      prefix: [],
      history: [user],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const messages = projectCompatMessages(request, {
      thinkingMode: false,
      supportsImages: false
    })
    expect(messages[0]).toEqual({ role: 'system', content: 'stable-system-prefix' })
    const userContent = String(messages.find((message) => message.role === 'user')?.content ?? '')
    expect(userContent).toContain('Use the selected clips')
    expect(userContent).toContain('untrusted reference data')
    expect(userContent).toContain(composerContextFixture.attachmentId)
    expect(userContent.match(new RegExp(composerContextFixture.attachmentId, 'g'))).toHaveLength(1)
    expect(messages.filter((message) => message.role === 'system').map((message) => message.content))
      .toEqual(['stable-system-prefix'])
  })

  it('orders stable prompt, profile, mode, history, and turn context', () => {
    const request: ModelRequest = {
      threadId: 'thread-order',
      turnId: 'turn-order',
      model: 'test-model',
      systemPrompt: 'stable-system-prefix',
      threadProfileInstruction: 'thread-profile',
      modeInstruction: 'mode-instruction',
      prefix: [],
      history: [makeUserItem({
        id: 'item-order',
        threadId: 'thread-order',
        turnId: 'turn-order',
        text: 'user-history'
      })],
      contextInstructions: ['turn-context-preamble', 'turn-context-block'],
      tools: [],
      abortSignal: new AbortController().signal
    }

    expect(projectCompatMessages(request, {
      thinkingMode: false,
      supportsImages: false
    }).map((message) => [message.role, message.content])).toEqual([
      ['system', 'stable-system-prefix'],
      ['system', 'thread-profile'],
      ['system', 'mode-instruction'],
      ['user', 'user-history'],
      ['system', 'turn-context-preamble'],
      ['system', 'turn-context-block']
    ])
  })

  it('keeps the stable prefix and history byte-identical when a persona changes', () => {
    const requestFor = (personaBlock?: string): ModelRequest => ({
      threadId: 'thread-persona',
      turnId: 'turn-persona',
      model: 'test-model',
      systemPrompt: 'stable-system-prefix',
      modeInstruction: 'mode-instruction',
      prefix: [],
      history: [makeUserItem({
        id: 'item-persona',
        threadId: 'thread-persona',
        turnId: 'turn-persona',
        text: 'user-history'
      })],
      ...(personaBlock ? { contextInstructions: ['turn-context-preamble', personaBlock] } : {}),
      tools: [],
      abortSignal: new AbortController().signal
    })
    const project = (personaBlock?: string): Array<[string, unknown]> =>
      projectCompatMessages(requestFor(personaBlock), {
        thinkingMode: false,
        supportsImages: false
      }).map((message) => [message.role, message.content])

    const withoutPersona = project()
    const withPersona = project('<kun_context_block kind="persona" authority="user">skeptic</kun_context_block>')

    // Everything the provider caches — prefix, mode, and history — is untouched;
    // the persona only appends after it. This is what makes switching cheap.
    expect(withPersona.slice(0, withoutPersona.length)).toEqual(withoutPersona)
    expect(withPersona[withPersona.length - 1]?.[1]).toContain('kind="persona"')
  })

  it('keeps request-local host control in Codex Responses input, not instructions', () => {
    const request: ModelRequest = {
      threadId: 'thread-codex-context',
      turnId: 'turn-codex-context',
      model: 'gpt-5.6',
      systemPrompt: 'stable-system-prefix',
      prefix: [],
      history: [makeUserItem({
        id: 'context-user',
        threadId: 'thread-codex-context',
        turnId: 'turn-codex-context',
        text: 'Revise the selected slide.'
      })],
      contextInstructions: [
        'turn-context-preamble',
        '<kun_context_block kind="host-control">PRIVATE HOST CONTROL</kun_context_block>'
      ],
      promptCachePartition: 'stable-partition',
      tools: [],
      abortSignal: new AbortController().signal
    }
    const messages = projectCompatMessages(request, {
      thinkingMode: false,
      supportsImages: false
    })
    const dynamic = messages.filter((message) => (
      String(message.content).includes('PRIVATE HOST CONTROL')
    ))
    expect(dynamic).toHaveLength(1)
    expect(dynamic[0]?.[COMPAT_HISTORY_CONTEXT]).toBe(true)

    const wire = createCompatRequestCodecs().build({
      request,
      model: request.model,
      messages,
      tools: [],
      stream: false,
      endpointFormat: 'responses',
      baseUrl: 'https://api.openai.com/v1',
      isCodex: true,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })
    expect(wire.instructions).toBe('stable-system-prefix')
    expect(JSON.stringify(wire.instructions)).not.toContain('PRIVATE HOST CONTROL')
    expect(JSON.stringify(wire.input)).toContain('PRIVATE HOST CONTROL')
    expect(wire.prompt_cache_key).toBe('thread-codex-context:stable-partition')
  })

  it('projects durable goal context as history rather than a per-request instruction', () => {
    const request: ModelRequest = {
      threadId: 'thread-goal',
      turnId: 'turn-goal',
      model: 'test-model',
      systemPrompt: 'stable-system-prefix',
      prefix: [],
      history: [
        makeGoalContextItem({
          id: 'goal-context',
          threadId: 'thread-goal',
          turnId: 'turn-goal',
          text: 'Goal objective stays in append-only history.',
          createdAt: '2026-08-06T00:00:00.000Z'
        }),
        makeUserItem({
          id: 'goal-user',
          threadId: 'thread-goal',
          turnId: 'turn-goal',
          text: 'Continue.'
        })
      ],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const messages = projectCompatMessages(request, {
      thinkingMode: false,
      supportsImages: false
    })
    const goal = messages[1]
    expect(goal).toMatchObject({
      role: 'system',
      content: 'Goal objective stays in append-only history.'
    })
    expect(goal?.[COMPAT_HISTORY_CONTEXT]).toBe(true)
  })

  it('keeps prior wire history intact when a later turn selects another persona', () => {
    const firstUser = makeUserItem({
      id: 'persona-user-one', threadId: 'thread-personas', turnId: 'turn-one', text: 'First request'
    })
    const firstContext = makeModelContextItem({
      id: 'persona-context-one', threadId: 'thread-personas', turnId: 'turn-one',
      stepIndex: 0, contentDigest: 'first', createdAt: '2026-08-12T00:00:00.000Z',
      blocks: [{ key: 'persona:user:0', kind: 'persona', authority: 'user', state: 'active', digest: 'one' }],
      text: 'Persona one capsule'
    })
    const firstRequest: ModelRequest = {
      threadId: 'thread-personas', turnId: 'turn-one', model: 'test-model',
      systemPrompt: 'stable-system-prefix', prefix: [], history: [firstUser, firstContext],
      tools: [], abortSignal: new AbortController().signal
    }
    const firstWire = projectCompatMessages(firstRequest, {
      thinkingMode: false, supportsImages: false
    })
    const secondUser = makeUserItem({
      id: 'persona-user-two', threadId: 'thread-personas', turnId: 'turn-two', text: 'Second request'
    })
    const secondContext = makeModelContextItem({
      id: 'persona-context-two', threadId: 'thread-personas', turnId: 'turn-two',
      stepIndex: 0, contentDigest: 'second', createdAt: '2026-08-12T00:01:00.000Z',
      blocks: [{ key: 'persona:user:0', kind: 'persona', authority: 'user', state: 'active', digest: 'two' }],
      text: 'Persona two capsule'
    })
    const secondWire = projectCompatMessages({
      ...firstRequest,
      turnId: 'turn-two',
      history: [...firstRequest.history, secondUser, secondContext]
    }, { thinkingMode: false, supportsImages: false })

    expect(secondWire.slice(0, firstWire.length)).toEqual(firstWire)
    expect(secondWire.slice(firstWire.length).map((message) => [message.role, message.content]))
      .toEqual([
        ['user', 'Second request'],
        ['system', 'Persona two capsule']
      ])
    expect(secondWire.at(-1)?.[COMPAT_HISTORY_CONTEXT]).toBe(true)
  })

  it('replays images and documents on the user message that originally owned them', () => {
    const first = makeUserItem({
      id: 'attachment-user-one', threadId: 'thread-attachments', turnId: 'turn-one',
      text: 'Inspect image', attachmentIds: ['image-one']
    })
    const second = makeUserItem({
      id: 'attachment-user-two', threadId: 'thread-attachments', turnId: 'turn-two',
      text: 'Inspect document', attachmentIds: ['document-two']
    })
    const messages = projectCompatMessages({
      threadId: 'thread-attachments', turnId: 'turn-two', model: 'vision-model',
      prefix: [], history: [first, second], tools: [],
      messageAttachments: {
        [first.id]: {
          images: [{ id: 'image-one', name: 'one.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
          textFallbacks: [], documents: [], unavailable: []
        },
        [second.id]: {
          images: [], textFallbacks: [],
          documents: [{
            id: 'document-two', name: 'two.txt', mimeType: 'text/plain',
            text: 'document body', byteSize: 13
          }],
          unavailable: []
        }
      },
      abortSignal: new AbortController().signal
    }, { thinkingMode: false, supportsImages: true })

    expect(messages[0]?.content).toEqual([
      { type: 'text', text: 'Inspect image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }
    ])
    expect(String(messages[1]?.content)).toContain('Inspect document')
    expect(String(messages[1]?.content)).toContain('document body')
  })

  it('replays complete historical DeepSeek tool rounds only on the identical route', () => {
    const threadId = 'thread-deepseek'
    const priorTurnId = 'turn-prior'
    const request: ModelRequest = {
      threadId,
      turnId: 'turn-current',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek',
      accountId: 'account-a',
      prefix: [],
      history: [
        makeAssistantReasoningItem({
          id: 'reason-prior', threadId, turnId: priorTurnId,
          text: 'inspect the requested file', status: 'completed'
        }),
        makeToolCallItem({
          id: 'call-prior', threadId, turnId: priorTurnId, callId: 'call-prior',
          toolName: 'read_file', arguments: { path: 'a.ts' }, status: 'completed'
        }),
        makeToolResultItem({
          id: 'result-prior', threadId, turnId: priorTurnId, callId: 'call-prior',
          toolName: 'read_file', output: 'contents', status: 'completed'
        })
      ],
      historyRoutesByTurnId: {
        [priorTurnId]: { model: 'deepseek-v4-pro', providerId: 'deepseek', accountId: 'account-a' }
      },
      tools: [],
      abortSignal: new AbortController().signal
    }

    const messages = projectCompatMessages(request, {
      thinkingMode: true,
      strictThinkingToolReplay: true,
      supportsImages: false
    })
    expect(messages.find((message) => message.tool_calls?.length)).toMatchObject({
      reasoning_content: 'inspect the requested file'
    })

    const switched = projectCompatMessages({
      ...request,
      model: 'deepseek-v4-flash',
      historyRoutesByTurnId: {
        [priorTurnId]: { model: 'deepseek-v4-pro', providerId: 'deepseek', accountId: 'account-a' }
      }
    }, {
      thinkingMode: true,
      strictThinkingToolReplay: true,
      supportsImages: false
    })
    expect(switched.some((message) => message.tool_calls?.length)).toBe(false)
    expect(switched.some((message) => message.role === 'tool')).toBe(false)
  })

  it('replays a parallel tool round whose user_input gate record lands between results', () => {
    const ids = { threadId: 'thread-gate', turnId: 'turn-gate' }
    const request: ModelRequest = {
      ...ids,
      model: 'test-model',
      prefix: [],
      history: [
        makeUserItem({ ...ids, id: 'user', text: 'Start the interview now.' }),
        makeToolCallItem({ ...ids, id: 'call-im', callId: 'im', toolName: 'send_im_message', arguments: { text: 'hi' }, status: 'completed' }),
        makeToolCallItem({ ...ids, id: 'call-ask', callId: 'ask', toolName: 'user_input', arguments: { question: 'Q1?' }, status: 'completed' }),
        makeToolResultItem({ ...ids, id: 'result-im', callId: 'im', toolName: 'send_im_message', output: { accepted: true } }),
        makeUserInputItem({ ...ids, id: 'gate', inputId: 'in-1', prompt: 'Q1?' }),
        makeToolResultItem({ ...ids, id: 'result-ask', callId: 'ask', toolName: 'user_input', output: { status: 'submitted', answers: [{ value: 'Research' }] } })
      ],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const messages = projectCompatMessages(request, { thinkingMode: false, supportsImages: false })
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'tool'])
    expect(messages[1]?.tool_calls?.map((call) => call.id)).toEqual(['im', 'ask'])
    expect(String(messages[3]?.content)).toContain('Research')
  })
})
