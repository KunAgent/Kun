import { describe, expect, it } from 'vitest'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../src/adapters/tool/goal-tools.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness, type Harness } from './loop-test-harness.js'

function makeGoalTools(getHarness: () => Harness) {
  return [
    LocalToolHost.defineTool({
      name: GET_GOAL_TOOL_NAME,
      description: 'Get goal',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (_args, context) => ({
        output: { goal: await getHarness().threads.getGoal(context.threadId) }
      })
    }),
    LocalToolHost.defineTool({
      name: UPDATE_GOAL_TOOL_NAME,
      description: 'Update goal',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['complete', 'blocked'] }
        },
        required: ['status'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => {
        const status = args.status
        if (status !== 'complete' && status !== 'blocked') {
          return { output: { error: 'invalid status' }, isError: true }
        }
        const goal = await getHarness().threads.setGoal(context.threadId, { status })
        return { output: { goal } }
      }
    })
  ]
}

async function loadRepetitionStops(h: Harness) {
  return (await h.sessionStore.loadItems(h.threadId)).filter(
    (item) => item.kind === 'error' && item.code === 'goal_repetition_stop'
  )
}

describe('goal continuation repetition guard', () => {
  it('tries recovery prompts before stopping repeated no-tool replies', async () => {
    let h: Harness
    let calls = 0
    const requests: ModelRequest[] = []
    h = makeHarness(
      {
        provider: 'goal-repeat',
        model: 'goal-repeat',
        async *stream(request): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          yield {
            kind: 'assistant_text_delta',
            text: calls === 1 ? 'I will run the build command now.' : 'i will run the build command NOW!!'
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)] }
    )
    await bootstrapThread(h, { request: { prompt: 'run the build' } })
    await h.threads.setGoal(h.threadId, { objective: 'run the build', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(5)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('active')
    expect(requests.some((request) =>
      request.contextInstructions?.some((line) => line.includes('Goal continuation recovery:'))
    )).toBe(true)
    const stops = await loadRepetitionStops(h)
    expect(stops).toHaveLength(1)
    expect(stops[0]?.kind === 'error' ? stops[0].severity : undefined).toBe('warning')
  })

  it('stops only after near-identical reordered replies exhaust recovery', async () => {
    let h: Harness
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-reorder',
        model: 'goal-reorder',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          yield {
            kind: 'assistant_text_delta',
            text: calls === 1
              ? 'I will now run the build command.'
              : 'Now I will run the build command.'
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)] }
    )
    await bootstrapThread(h, { request: { prompt: 'run the build' } })
    await h.threads.setGoal(h.threadId, { objective: 'run the build', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(5)
    expect(await loadRepetitionStops(h)).toHaveLength(1)
  })

  it('lets a repeated no-tool reply recover by calling update_goal', async () => {
    let h: Harness
    let calls = 0
    const requests: ModelRequest[] = []
    h = makeHarness(
      {
        provider: 'goal-recover',
        model: 'goal-recover',
        async *stream(request): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls <= 2) {
            yield { kind: 'assistant_text_delta', text: 'I will run the build command now.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete_goal',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Goal complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)] }
    )
    await bootstrapThread(h, { request: { prompt: 'run the build' } })
    await h.threads.setGoal(h.threadId, { objective: 'run the build', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    expect(requests[2]?.contextInstructions?.join('\n')).toContain('Goal continuation recovery:')
    expect(await loadRepetitionStops(h)).toHaveLength(0)
  })

  it('keeps continuing while no-tool replies make distinct progress', async () => {
    let h: Harness
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-progress',
        model: 'goal-progress',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield { kind: 'assistant_text_delta', text: 'Draft ready.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 2) {
            yield { kind: 'assistant_text_delta', text: 'Benchmarks recorded, wrapping up the summary.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete_goal',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Goal complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)] }
    )
    await bootstrapThread(h, { request: { prompt: 'write a benchmark note' } })
    await h.threads.setGoal(h.threadId, { objective: 'write a benchmark note', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    expect(await loadRepetitionStops(h)).toHaveLength(0)
  })

  it('resets the repetition window after a step that calls tools', async () => {
    let h: Harness
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-reset',
        model: 'goal-reset',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 2) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_get_goal',
              toolName: GET_GOAL_TOOL_NAME,
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Working on it.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)] }
    )
    await bootstrapThread(h, { request: { prompt: 'keep working' } })
    await h.threads.setGoal(h.threadId, { objective: 'keep working', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    // Step 1 stores the text, step 2's tool call resets the window, step 3
    // stores it again, and the guard gives three recovery prompts before
    // stopping the repeated no-tool replies.
    expect(status).toBe('completed')
    expect(calls).toBe(7)
    expect(await loadRepetitionStops(h)).toHaveLength(1)
  })
})
