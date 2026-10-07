import { describe, expect, test } from 'vitest'
import {
  AgentSdkRuntime,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkApi, SdkMessage, SdkQueryResult } from './sdk-protocol.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

type Snapshot = Extract<RuntimeEventDraft, { kind: 'context_snapshot' }>

// What the GUI hands a Claude Code turn when the provider has no usable window:
// the conservative 32k estimate with its derived thresholds.
const CONSERVATIVE_PROFILE = {
  contextWindowTokens: 32_000,
  softThresholdTokens: 24_000,
  hardThresholdTokens: 27_200
}

function sdkWith(messages: SdkMessage[]): SdkApi {
  return {
    query: (): SdkQueryResult => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for (const message of messages) yield message
      }
      const stream = gen() as SdkQueryResult
      stream.interrupt = async () => {}
      return stream
    },
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: (name) => ({ name })
  }
}

async function runTurn(
  messages: SdkMessage[],
  ctxOverrides: Partial<SdkTurnContext> = {}
): Promise<Snapshot[]> {
  const events: RuntimeEventDraft[] = []
  const ctx: SdkTurnContext = {
    workspace: '/ws',
    userText: 'hi',
    approvalPolicy: 'auto',
    model: 'claude-haiku-4-5',
    contextProfile: CONSERVATIVE_PROFILE,
    bridgeableTools: [{ name: 'generate_image', description: 'gen', inputSchema: {} }],
    ...ctxOverrides
  }
  let n = 0
  const deps: SdkRuntimeDeps = {
    handlesProvider: () => true,
    loadTurnContext: async () => ctx,
    executeKunTool: async () => ({ output: 'ok' }),
    decideToolApproval: async () => ({ allow: true }),
    recordEvent: async (draft) => { events.push(draft) },
    applyItem: async () => {},
    applyAssistantDelta: async () => {},
    finishTurn: async () => {},
    saveSessionId: async () => {},
    loadSdk: async () => sdkWith(messages),
    baseEnv: () => ({ PATH: '/bin' }),
    kunSystemPrompt: () => 'You are kun.',
    nextId: (prefix) => `${prefix}_${++n}`
  }
  await new AgentSdkRuntime(deps).runTurn('thread', 'turn', new AbortController().signal)
  return events.filter((event): event is Snapshot => event.kind === 'context_snapshot')
}

const MAIN_REQUEST: SdkMessage = {
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: 'Hi!' }],
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 38_000,
      output_tokens: 20
    }
  }
} as SdkMessage

const RESULT: SdkMessage = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Hi!',
  num_turns: 1,
  usage: { input_tokens: 12, output_tokens: 20 },
  modelUsage: { 'claude-haiku-4-5-20251001': { contextWindow: 200_000 } }
} as SdkMessage

describe('AgentSdkRuntime context snapshots', () => {
  test('replaces the start-of-turn estimate with the real occupancy and window the SDK reports', async () => {
    const snapshots = await runTurn([MAIN_REQUEST, RESULT])

    expect(snapshots).toHaveLength(2)
    const [estimate, live] = snapshots
    expect(estimate.contextWindowTokens).toBe(32_000)
    expect(estimate.nativeHistory).toBe('none')

    expect(live).toMatchObject({
      model: 'claude-haiku-4-5',
      contextWindowTokens: 200_000,
      softThresholdTokens: 150_000,
      hardThresholdTokens: 170_000,
      estimatedInputTokens: 38_032,
      contextManagement: 'sdk-managed',
      nativeHistory: 'known'
    })
    const { tools, system, skills, messages, other } = live.breakdown
    expect(tools + system + skills + messages + other).toBe(38_032)
  })

  test('keeps only the start estimate when the SDK reports no usage', async () => {
    const snapshots = await runTurn([{
      type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1
    } as SdkMessage])

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].nativeHistory).toBe('none')
  })

  test('still reports the real occupancy when no window can be matched', async () => {
    const snapshots = await runTurn([MAIN_REQUEST, { ...RESULT, modelUsage: undefined } as SdkMessage])

    const live = snapshots.at(-1)!
    expect(live.estimatedInputTokens).toBe(38_032)
    expect(live.contextWindowTokens).toBe(32_000)
  })
})
