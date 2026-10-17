import type { LocalAgentStore } from '@cursor/sdk'
import { describe, expect, test } from 'vitest'
import { cursorContextSnapshot, cursorTokenDetails, observeCursorCheckpointContext } from './cursor-checkpoint-context.js'

function varint(value: number): number[] {
  const out: number[] = []
  let rest = value
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80)
    rest = Math.floor(rest / 0x80)
  }
  out.push(rest)
  return out
}
const num = (no: number, value: number): number[] => [...varint(no * 8), ...varint(value)]
const bytes = (no: number, value: number[] | string): number[] => {
  const payload = typeof value === 'string' ? [...new TextEncoder().encode(value)] : value
  return [...varint(no * 8 + 2), ...varint(payload.length), ...payload]
}
const category = (id: string, tokens?: number): number[] =>
  bytes(3, [...bytes(1, id), ...bytes(2, id.toUpperCase()), ...(tokens === undefined ? [] : num(3, tokens))])

/** A `ConversationStateStructure` with the fields around `token_details` filled in. */
function root(used: number, max: number, categories: number[][] = []): Uint8Array {
  const breakdown = [...num(1, used), ...num(2, max), ...categories.flat()]
  return Uint8Array.from([
    ...bytes(1, '{"role":"system"}'),
    ...bytes(8, [1, 2, 3]),
    ...bytes(5, [...num(1, used), ...num(2, max), ...bytes(3, breakdown)]),
    ...bytes(14, [...num(1, 1200), ...num(2, 1_790_000_000_000)])
  ])
}

describe('Cursor checkpoint token details', () => {
  test('folds Cursor categories into the gauge categories, summing to its total', () => {
    expect(cursorTokenDetails(root(89_727, 256_000, [
      category('system_prompt', 984), category('tools', 7_426), category('rules', 1_875), category('skills'),
      category('mcp', 4_552), category('subagents', 910), category('summarized_conversation'), category('conversation', 73_980)
    ]))).toEqual({
      usedTokens: 89_727,
      maxTokens: 256_000,
      breakdown: { system: 2_859, tools: 12_888, skills: 0, messages: 73_980, other: 0 },
      categorized: true
    })
    // Unknown categories and an uncounted remainder land in "other".
    expect(cursorTokenDetails(root(1_000, 8_000, [category('conversation', 600), category('images', 100)]))?.breakdown)
      .toEqual({ system: 0, tools: 0, skills: 0, messages: 600, other: 400 })
  })

  test('without a usable breakdown the whole count is conversation', () => {
    expect(cursorTokenDetails(root(5_000, 200_000))).toMatchObject({
      breakdown: { system: 0, tools: 0, skills: 0, messages: 5_000, other: 0 }, categorized: false
    })
    expect(cursorTokenDetails(root(5_000, 200_000, [category('tools', 9_000)]))).toMatchObject({
      breakdown: { messages: 5_000 }, categorized: false
    })
  })

  test('a blob without token details, or not a protobuf at all, reports nothing', () => {
    expect(cursorTokenDetails(Uint8Array.from(bytes(1, 'x')))).toBeUndefined()
    expect(cursorTokenDetails(root(0, 256_000))).toBeUndefined()
    expect(cursorTokenDetails(new TextEncoder().encode('{"role":"user","content":"hi"}'))).toBeUndefined()
    expect(cursorTokenDetails(Uint8Array.from([0x2a, 0x40, 0x01]))).toBeUndefined()
  })

  test('the snapshot is Agent-reported against Cursor\'s own window', () => {
    const input = { threadId: 'thr', turnId: 'turn', model: 'grok-4.6', providerId: 'cursor-subscription', toolCount: 3, activeSkillIds: [] }
    const details = cursorTokenDetails(root(89_727, 256_000, [category('conversation', 89_727)]))!
    expect(cursorContextSnapshot(input, details)).toMatchObject({
      kind: 'context_snapshot',
      contextWindowTokens: 256_000,
      contextWindowKnown: true,
      estimatedInputTokens: 89_727,
      breakdown: { messages: 89_727 },
      contextManagement: 'sdk-managed',
      nativeHistory: 'known',
      occupancySource: 'agent',
      breakdownSource: 'agent'
    })
    // Without Cursor's own categories the total is not presented as split.
    expect(cursorContextSnapshot(input, cursorTokenDetails(root(5_000, 200_000))!)).not.toHaveProperty('breakdownSource')
  })
})

describe('observeCursorCheckpointContext', () => {
  function fakeStore() {
    const blobs = new Map<string, Uint8Array>()
    const calls: string[] = []
    const store = {
      agents: {
        update: async (input: { agent: unknown }) => { calls.push('agents.update'); return input.agent },
        get: async () => { calls.push('agents.get'); return null }
      },
      runs: { update: async (input: { run: unknown }) => { calls.push('runs.update'); return input.run } },
      checkpoints: { get: async ({ blobId }: { blobId: string }) => blobs.get(blobId) ?? null },
      runEvents: {},
      label: 'jsonl'
    }
    return { blobs, calls, store: store as unknown as LocalAgentStore & { label: string } }
  }

  test('reports each new root once, in step order, and forwards every call', async () => {
    const { blobs, calls, store } = fakeStore()
    blobs.set('root1', root(15_000, 256_000))
    blobs.set('root2', root(17_500, 256_000))
    blobs.set('message', new TextEncoder().encode('{"role":"user"}'))
    const seen: number[] = []
    const observed = observeCursorCheckpointContext(store, (details) => seen.push(details.usedTokens))

    await observed.runs.update({ run: { agentId: 'agent', latestCheckpointRef: { schemaVersion: 1, rootBlobId: 'root1' } } } as never)
    await observed.agents.update({ agent: { agentId: 'agent', latestCheckpoint: { schemaVersion: 1, rootBlobId: 'root1' } } } as never)
    await observed.agents.update({ agent: { agentId: 'agent', latestCheckpoint: { schemaVersion: 1, rootBlobId: 'message' } } } as never)
    await observed.runs.update({ run: { agentId: 'agent', latestCheckpointRef: { schemaVersion: 1, rootBlobId: 'root2' } } } as never)
    await observed.agents.update({ agent: { agentId: 'agent', latestCheckpoint: null } } as never)
    await observed.agents.get({ agentId: 'agent' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(seen).toEqual([15_000, 17_500])
    expect(calls).toEqual(['runs.update', 'agents.update', 'agents.update', 'runs.update', 'agents.update', 'agents.get'])
    expect((observed as typeof store).label).toBe('jsonl')
  })

  test('a failing checkpoint read never reaches the store caller', async () => {
    const { store } = fakeStore()
    ;(store.checkpoints as { get: unknown }).get = async () => { throw new Error('gone') }
    const seen: number[] = []
    const observed = observeCursorCheckpointContext(store, (details) => seen.push(details.usedTokens))
    await expect(observed.runs.update({ run: { agentId: 'agent', latestCheckpointRef: { schemaVersion: 1, rootBlobId: 'r' } } } as never))
      .resolves.toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([])
  })
})
