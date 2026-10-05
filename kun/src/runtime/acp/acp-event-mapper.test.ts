import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { AcpEventMapper } from './acp-event-mapper.js'
import { parseAcpSessionUpdate } from './acp-schema.js'

const SCENARIOS = fileURLToPath(
  new URL('./__fixtures__/scenarios/', import.meta.url)
)

type ScenarioFile = {
  turns?: Array<{ steps?: Array<{ update?: Record<string, unknown> }> }>
  [key: string]: unknown
}

function scenario(name: string): ScenarioFile {
  return JSON.parse(readFileSync(join(SCENARIOS, name), 'utf8'))
}

function updatesOf(name: string, ...keys: string[]): Array<Record<string, unknown>> {
  const file = scenario(name)
  const out: Array<Record<string, unknown>> = []
  for (const key of keys) {
    if (key === 'turns') {
      for (const turn of file.turns ?? []) {
        for (const step of turn.steps ?? []) {
          if (step.update) out.push(step.update)
        }
      }
      continue
    }
    const section = file[key] as { updates?: Array<Record<string, unknown>> } | undefined
    for (const update of section?.updates ?? []) {
      out.push(update)
    }
  }
  return out
}

function itemOf(draft: RuntimeEventDraft): TurnItem {
  if (!('item' in draft)) throw new Error(`draft ${draft.kind} carries no item`)
  return draft.item as TurnItem
}

function makeMapper(debugSink?: string[]): {
  mapper: AcpEventMapper
  applyAll(updates: Array<Record<string, unknown>>): RuntimeEventDraft[]
} {
  let n = 0
  const mapper = new AcpEventMapper({
    threadId: 'thread_1',
    turnId: 'turn_1',
    harnessId: 'gemini-cli',
    model: 'fake-model-1',
    nextId: (prefix) => `${prefix}_${++n}`,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    debug: (entry) => debugSink?.push(entry.summary)
  })
  return {
    mapper,
    applyAll: (updates) =>
      updates.flatMap((update) => mapper.apply(parseAcpSessionUpdate(update)))
  }
}

const kinds = (drafts: RuntimeEventDraft[]) => drafts.map((d) => d.kind)

describe('AcpEventMapper', () => {
  test('text chunks emit deltas; flush emits the complete assistant_text item', () => {
    const { mapper, applyAll } = makeMapper()
    const drafts = applyAll(updatesOf('basic-chat.json', 'turns'))
    expect(kinds(drafts)).toEqual([
      'assistant_text_delta',
      'assistant_text_delta'
    ])
    for (const draft of drafts) {
      expect((itemOf(draft) as { status: string }).status).toBe('running')
    }
    const flushed = mapper.flush()
    expect(kinds(flushed)).toEqual(['item_created'])
    const item = itemOf(flushed[0]) as { kind: string; text: string; status: string }
    expect(item).toMatchObject({
      kind: 'assistant_text',
      text: 'Hello world',
      status: 'completed'
    })
  })

  test('thought chunks map to reasoning, kept separate from text', () => {
    const { mapper, applyAll } = makeMapper()
    const drafts = applyAll([
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking ' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } },
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'more' } }
    ])
    expect(kinds(drafts)).toEqual([
      'assistant_reasoning_delta',
      'item_created',
      'assistant_text_delta',
      'item_created',
      'assistant_reasoning_delta'
    ])
    const flushed = mapper.flush()
    const completed = [...drafts, ...flushed].filter((d) => d.kind === 'item_created')
    const reasoning = completed.filter(
      (d) => (itemOf(d) as { kind: string }).kind === 'assistant_reasoning'
    )
    const text = completed.find(
      (d) => (itemOf(d) as { kind: string }).kind === 'assistant_text'
    )
    expect(reasoning.map((draft) => (itemOf(draft) as { text: string }).text)).toEqual(['thinking ', 'more'])
    expect((text && (itemOf(text) as { text: string }).text)).toBe('answer')
  })

  test('tool_call lifecycle: ready → started → finished with structured result', () => {
    const { applyAll } = makeMapper()
    const drafts = applyAll([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read file',
        kind: 'read',
        status: 'pending'
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'file body' } }
        ]
      }
    ])
    expect(kinds(drafts)).toEqual([
      'item_created',
      'tool_call_ready',
      'item_updated',
      'tool_call_started',
      'item_updated',
      'tool_call_finished'
    ])
    const call = itemOf(drafts[0]) as Record<string, unknown>
    expect(call).toMatchObject({
      kind: 'tool_call',
      toolName: 'acp:read',
      callId: 'call-1',
      status: 'pending'
    })
    const result = itemOf(drafts.at(-1)!) as Record<string, unknown>
    expect(result).toMatchObject({
      kind: 'tool_result',
      callId: 'call-1',
      output: 'file body',
      status: 'completed'
    })
  })

  test('an update arriving before tool_call creates a placeholder, finished once', () => {
    const { applyAll } = makeMapper()
    const drafts = applyAll([
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'in_progress' },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-9',
        title: 'Edit file',
        kind: 'edit',
        status: 'in_progress'
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'completed' },
      // duplicate terminal — ignored
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'completed' }
    ])
    expect(kinds(drafts)).toEqual([
      'item_created',
      'tool_call_ready',
      'tool_call_started',
      'item_updated',
      'item_updated',
      'tool_call_finished'
    ])
    const call = itemOf(drafts[0]) as Record<string, unknown>
    expect(call).toMatchObject({ kind: 'tool_call', status: 'running' })
    const finished = drafts.filter((d) => d.kind === 'tool_call_finished')
    expect(finished).toHaveLength(1)
  })

  test('diff content produces structured { diffs } output with null oldText for new files', () => {
    const { applyAll } = makeMapper()
    const drafts = applyAll([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-d',
        title: 'Write file',
        kind: 'edit',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'src/new.ts',
            oldText: null,
            newText: 'export const x = 1\n'
          },
          {
            type: 'diff',
            path: 'src/old.ts',
            oldText: 'before',
            newText: 'after'
          }
        ]
      }
    ])
    const finished = drafts.find((d) => d.kind === 'tool_call_finished')
    const item = (finished && itemOf(finished)) as { toolKind: string; output: { diffs: unknown[] } }
    expect(item.toolKind).toBe('file_change')
    expect(item.output.diffs).toEqual([
      { path: 'src/new.ts', oldText: null, newText: 'export const x = 1\n' },
      { path: 'src/old.ts', oldText: 'before', newText: 'after' }
    ])
  })

  test('open tool calls are interrupted on flush', () => {
    const { mapper, applyAll } = makeMapper()
    applyAll([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-open',
        title: 'Hanging',
        kind: 'execute',
        status: 'in_progress'
      }
    ])
    const flushed = mapper.flush()
    expect(kinds(flushed)).toEqual(['tool_call_finished'])
    const item = itemOf(flushed[0]) as Record<string, unknown>
    expect(item).toMatchObject({
      kind: 'tool_result',
      status: 'aborted',
      output: 'interrupted',
      isError: true,
      toolName: 'acp:execute',
      toolKind: 'command_execution'
    })
  })

  test('plan entries map to todos with status', () => {
    const { applyAll } = makeMapper()
    const drafts = applyAll([
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'step one', priority: 'high', status: 'completed' },
          { content: 'step two', priority: 'medium', status: 'in_progress' },
          { content: 'step three', priority: 'low', status: 'pending' }
        ]
      }
    ])
    expect(kinds(drafts)).toEqual(['todos_updated'])
    const todos = (drafts[0] as { todos: { items: Array<{ status: string }> } }).todos
    expect(todos.items.map((item) => item.status)).toEqual([
      'completed',
      'in_progress',
      'pending'
    ])
  })

  test('usage_update emits context_snapshot plus usage facts', () => {
    const { mapper, applyAll } = makeMapper()
    const drafts = applyAll([
      { sessionUpdate: 'usage_update', used: 12_000, size: 200_000, cost: { amount: 0.02, currency: 'USD' } }
    ])
    expect(kinds(drafts)).toEqual(['context_snapshot', 'usage'])
    const snapshot = drafts[0] as unknown as { contextWindowTokens: number; estimatedInputTokens: number }
    expect(snapshot.contextWindowTokens).toBe(200_000)
    expect(snapshot.estimatedInputTokens).toBe(12_000)
    expect(mapper.observedFacts.sawUsageTelemetry).toBe(true)
    expect(mapper.observedFacts.sawUsageTokens).toBe(true)
  })

  test('available_commands_update / current_mode_update / config_option_update emit session_state', () => {
    const { mapper, applyAll } = makeMapper()
    const drafts = applyAll([
      {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'compact', description: 'Compact' }]
      },
      { sessionUpdate: 'current_mode_update', currentModeId: 'auto' },
      {
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'model',
            type: 'select',
            category: 'model',
            currentValue: 'm2',
            options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }]
          }
        ]
      }
    ])
    expect(kinds(drafts)).toEqual([
      'harness_session_state',
      'harness_session_state',
      'harness_session_state'
    ])
    expect(drafts[0]).toMatchObject({ commands: [{ name: 'compact' }] })
    expect(drafts[1]).toMatchObject({ currentModeId: 'auto' })
    expect(drafts[2]).toMatchObject({
      configOptions: [
        { id: 'model', category: 'model', currentValue: 'm2', values: ['m1', 'm2'] }
      ]
    })
    expect(mapper.observedFacts.sawAvailableCommands).toBe(true)
    expect(mapper.observedFacts.currentModeId).toBe('auto')
  })

  test('prompt-result usage produces a usage event and the token fact', () => {
    const { mapper } = makeMapper()
    const drafts = mapper.applyPromptResult({
      totalTokens: 1_100,
      inputTokens: 1_000,
      outputTokens: 100,
      cachedReadTokens: 400
    })
    expect(kinds(drafts)).toEqual(['usage'])
    expect((drafts[0] as { usage: { promptTokens: number; cachedTokens?: number } }).usage).toMatchObject({
      promptTokens: 1_000,
      completionTokens: 100,
      totalTokens: 1_100,
      cachedTokens: 400
    })
    expect(mapper.observedFacts.sawUsageTokens).toBe(true)
  })

  test('user_message_chunk is ignored and unknown variants debug-log only', () => {
    const debug: string[] = []
    const { applyAll } = makeMapper(debug)
    const drafts = applyAll([
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } },
      { sessionUpdate: 'brand_new_update', extra: 1 },
      { sessionUpdate: 'session_info_update', title: 'T' }
    ])
    expect(drafts).toHaveLength(0)
    expect(debug.some((line) => line.includes('brand_new_update'))).toBe(true)
  })
})
