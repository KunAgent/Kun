import { afterEach, expect, test } from 'vitest'
import { AgentSdkRuntime, type SdkRuntimeDeps } from './agent-sdk-runtime.js'
import type { SdkApi, SdkMessage, SdkQueryResult } from './sdk-protocol.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { setHarnessTimingClock } from '../harness-turn-timing.js'

afterEach(() => setHarnessTimingClock(undefined))

const text = 'abcdefghij'.repeat(3) + 'abcde' // 10 estimated tokens
const textDelta = (): SdkMessage => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }
}) as SdkMessage

test('stamps the Claude query usage with the TTFT and speed of the streamed answer', async () => {
  let clock = 0
  setHarnessTimingClock(() => clock)
  const sdk: SdkApi = {
    query: (): SdkQueryResult => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        clock = 500 // the CLI booted: the model is about to be called
        yield { type: 'system', subtype: 'init', session_id: 'sess_timing' } as SdkMessage
        clock = 2_700
        yield textDelta()
        for (let i = 1; i < 10; i += 1) { clock = 2_700 + i * 100; yield textDelta() }
        clock = 4_900 // `result` trails the stream by the CLI's post-turn work
        yield {
          type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 1,
          usage: { input_tokens: 1_000, output_tokens: 150 }
        } as SdkMessage
      }
      const stream = gen() as SdkQueryResult
      stream.interrupt = async () => {}
      return stream
    },
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: (name) => ({ name })
  }
  const events: RuntimeEventDraft[] = []
  let n = 0
  const deps: SdkRuntimeDeps = {
    handlesProvider: () => true,
    loadTurnContext: async () => ({ workspace: '/ws', userText: 'hello', approvalPolicy: 'auto', bridgeableTools: [] }),
    executeKunTool: async () => ({ output: '' }),
    decideToolApproval: async () => ({ allow: true }),
    recordEvent: async (draft) => { events.push(draft) },
    applyItem: async () => undefined,
    applyAssistantDelta: async () => undefined,
    finishTurn: async () => undefined,
    saveSessionId: async () => undefined,
    loadSdk: async () => sdk,
    baseEnv: () => ({ PATH: '/bin' }),
    kunSystemPrompt: () => 'You are kun.',
    nextId: (prefix) => `${prefix}_${++n}`
  }

  expect(await new AgentSdkRuntime(deps).runTurn('thread_timing', 'turn_timing', new AbortController().signal)).toBe('completed')

  const usage = events.find((event) => event.kind === 'usage')
  expect(usage?.kind === 'usage' && usage.usage).toMatchObject({
    completionTokens: 150,
    requestTtftMs: 2_200,
    requestGenerationMs: 900,
    requestGenerationTokens: 90
  })
})
