import { expect, test } from 'vitest'
import { AgentSdkRuntime, type SdkRuntimeDeps } from './agent-sdk-runtime.js'
import type { SdkApi, SdkMessage, SdkQueryResult } from './sdk-protocol.js'
import type { TurnItem } from '../../contracts/items.js'

const textDelta = (text: string): SdkMessage => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }
}) as SdkMessage
const assistant = (content: unknown[]): SdkMessage => ({
  type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content }
}) as SdkMessage
const toolResult = (id: string): SdkMessage => ({
  type: 'user', parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }
}) as SdkMessage

// Claude Code emits one SDK assistant message per content block, so a
// multi-step turn is text, tool, result, text, tool, result, text.
const messages: SdkMessage[] = [
  textDelta('Reading '), textDelta('a.ts.'),
  assistant([{ type: 'text', text: 'Reading a.ts.' }]),
  assistant([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } }]),
  toolResult('tu_1'),
  textDelta('Editing.'),
  assistant([{ type: 'text', text: 'Editing.' }]),
  assistant([{ type: 'tool_use', id: 'tu_2', name: 'Edit', input: { file_path: 'a.ts' } }]),
  toolResult('tu_2'),
  textDelta('Done.'),
  assistant([{ type: 'text', text: 'Done.' }]),
  {
    type: 'result', subtype: 'success', is_error: false, result: 'Done.',
    num_turns: 3, usage: { input_tokens: 1, output_tokens: 1 }
  } as SdkMessage
]

test('keeps each Claude Code step as its own text item with item-relative delta offsets', async () => {
  const sdk: SdkApi = {
    query: (): SdkQueryResult => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        yield { type: 'system', subtype: 'init', session_id: 'sess' } as SdkMessage
        for (const message of messages) yield message
      }
      const stream = gen() as SdkQueryResult
      stream.interrupt = async () => {}
      return stream
    },
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: (name) => ({ name })
  }
  const items: TurnItem[] = []
  const deltas: Array<{ id: string; text: string; delta: string; offset: number }> = []
  let n = 0
  const deps: SdkRuntimeDeps = {
    handlesProvider: () => true,
    loadTurnContext: async () => ({ workspace: '/ws', userText: 'go', approvalPolicy: 'auto', bridgeableTools: [] }),
    executeKunTool: async () => ({ output: '' }),
    decideToolApproval: async () => ({ allow: true }),
    recordEvent: async () => undefined,
    applyItem: async (_threadId, item) => { items.push(item) },
    applyAssistantDelta: async (_threadId, item, delta, offset) => {
      deltas.push({ id: item.id, text: 'text' in item ? item.text : '', delta, offset })
    },
    finishTurn: async () => undefined,
    saveSessionId: async () => undefined,
    loadSdk: async () => sdk,
    baseEnv: () => ({ PATH: '/bin' }),
    kunSystemPrompt: () => 'You are kun.',
    nextId: (prefix) => `${prefix}_${++n}`
  }

  expect(await new AgentSdkRuntime(deps).runTurn('th', 'tn', new AbortController().signal)).toBe('completed')

  const texts = items.filter((item) => item.kind === 'assistant_text')
  expect(texts.map((item) => 'text' in item ? item.text : '')).toEqual(['Reading a.ts.', 'Editing.', 'Done.'])
  expect(new Set(texts.map((item) => item.id)).size).toBe(3)
  // The final step's text item lands after every tool item, not before them.
  expect(items.findIndex((item) => item.id === texts[2]!.id))
    .toBeGreaterThan(items.map((item) => item.kind).lastIndexOf('tool_result'))
  // Each item's deltas start at offset 0 and carry only that item's text.
  for (const text of texts) {
    const own = deltas.filter((entry) => entry.id === text.id)
    expect(own[0]?.offset).toBe(0)
    expect(own.at(-1)?.text).toBe('text' in text ? text.text : '')
  }
})
