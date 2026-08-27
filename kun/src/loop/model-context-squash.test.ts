import { describe, expect, it } from 'vitest'
import type { ModelContextBlockState, ModelContextTurnItem, TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import {
  applyModelContextBaseline,
  squashModelContextHistory
} from './model-context-squash.js'

const threadId = 'thread_squash'
const nowIso = () => '2026-08-26T00:00:00.000Z'

function delta(
  id: string,
  turnId: string,
  blocks: Array<{ key: string; kind: string; authority: 'runtime'; content?: string; inactive?: boolean }>,
  createdAt: string
): ModelContextTurnItem {
  const rendered = blocks.map((block) => [
    `<kun_context_update key="${block.key}" kind="${block.kind}" authority="${block.authority}" state="${block.inactive ? 'inactive' : 'active'}">`,
    ...(block.content ? [block.content] : []),
    '</kun_context_update>'
  ].join('\n')).join('\n')
  const states: ModelContextBlockState[] = blocks.map((block) => ({
    key: block.key,
    kind: block.kind,
    authority: block.authority,
    state: block.inactive ? 'inactive' as const : 'active' as const,
    ...(block.content ? { content: block.content } : {})
  }))
  return {
    id,
    turnId,
    threadId,
    role: 'system',
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    kind: 'model_context',
    formatVersion: 1,
    stepIndex: 0,
    contentDigest: `digest-${id}`,
    blocks: states,
    text: `Kun append-only model context update (format 1).\n${rendered}`
  }
}

describe('squashModelContextHistory', () => {
  it('keeps only the last active value for a repeatedly updated key', () => {
    const history: TurnItem[] = []
    for (let index = 0; index < 100; index += 1) {
      history.push(delta(`ctx_${index}`, `turn_${index}`, [
        { key: 'agents-instructions:workspace:0', kind: 'agents-instructions', authority: 'runtime', content: `AGENTS v${index}` }
      ], `2026-08-26T00:${String(index % 60).padStart(2, '0')}:00.000Z`))
    }
    const result = squashModelContextHistory({ threadId, turnId: 'turn_final', history, nowIso })
    expect(result.baseline).not.toBeNull()
    expect(result.baseline!.blocks).toHaveLength(1)
    expect(result.baseline!.blocks[0]!.content).toBe('AGENTS v99')
    expect(result.replacedIds).toHaveLength(100)
    expect(result.unresolvableIds).toEqual([])
    // Baseline bytes stay flat, not 100x the largest content.
    expect(result.baseline!.text).toContain('AGENTS v99')
    expect(result.baseline!.text).not.toContain('AGENTS v0\n')
  })

  it('drops inactive blocks and preserves final authority per key', () => {
    const history: TurnItem[] = [
      delta('ctx_a', 'turn_a', [
        { key: 'skill:skill:0', kind: 'skill-instruction', authority: 'runtime', content: 'Skill A' },
        { key: 'memory:user:0', kind: 'memory', authority: 'runtime', content: 'Memory' }
      ], '2026-08-26T00:00:00.000Z'),
      delta('ctx_b', 'turn_b', [
        { key: 'skill:skill:0', kind: 'skill-instruction', authority: 'runtime', inactive: true },
        { key: 'memory:user:0', kind: 'memory', authority: 'runtime', content: 'Memory v2' }
      ], '2026-08-26T00:01:00.000Z')
    ]
    const result = squashModelContextHistory({ threadId, turnId: 'turn_c', history, nowIso })
    const keys = result.baseline!.blocks.map((block) => block.key)
    expect(keys).toEqual(['memory:user:0'])
    expect(result.baseline!.blocks[0]!.content).toBe('Memory v2')
  })

  it('preserves the active turn capsules untouched', () => {
    const history: TurnItem[] = [
      delta('ctx_old', 'turn_old', [
        { key: 'k:runtime:0', kind: 'k', authority: 'runtime', content: 'old value' }
      ], '2026-08-26T00:00:00.000Z'),
      delta('ctx_active', 'turn_active', [
        { key: 'k:runtime:0', kind: 'k', authority: 'runtime', content: 'active value' }
      ], '2026-08-26T00:01:00.000Z')
    ]
    const result = squashModelContextHistory({
      threadId, turnId: 'turn_new', history, activeTurnId: 'turn_active', nowIso
    })
    // Only the pre-active-turn delta is squashed; the active capsule survives.
    expect(result.replacedIds).toEqual(['ctx_old'])
    const applied = applyModelContextBaseline(history, result)
    expect(applied.map((item) => item.id)).toContain('ctx_active')
    expect(applied.some((item) => item.kind === 'model_context' && item.baseline)).toBe(true)
  })

  it('rebuilds legacy format-1 deltas by parsing the rendered envelope', () => {
    const legacy = delta('ctx_legacy', 'turn_legacy', [], '2026-08-26T00:00:00.000Z')
    legacy.blocks = [{ key: 'agents-instructions:workspace:0', kind: 'agents-instructions', authority: 'workspace', state: 'active' }]
    legacy.text = [
      'Kun append-only model context update (format 1).',
      '<kun_context_update key="agents-instructions:workspace:0" kind="agents-instructions" authority="workspace" state="active">',
      'Legacy instruction body.',
      '</kun_context_update>'
    ].join('\n')
    const history: TurnItem[] = [
      legacy,
      delta('ctx_inline', 'turn_inline', [
        { key: 'other:runtime:0', kind: 'other', authority: 'runtime', content: 'Inline value' }
      ], '2026-08-26T00:02:00.000Z')
    ]
    const result = squashModelContextHistory({ threadId, turnId: 'turn_next', history, nowIso })
    expect(result.baseline!.blocks.some((block) => block.content === 'Legacy instruction body.')).toBe(true)
    expect(result.baseline!.blocks.some((block) => block.content === 'Inline value')).toBe(true)
    expect(result.unresolvableIds).toEqual([])
  })

  it('keeps a single delta unchanged instead of emitting a redundant baseline', () => {
    const history: TurnItem[] = [
      delta('ctx_only', 'turn_only', [
        { key: 'k:runtime:0', kind: 'k', authority: 'runtime', content: 'only value' }
      ], '2026-08-26T00:00:00.000Z'),
      makeUserItem({ id: 'user', threadId, turnId: 'turn_only', text: 'hi' }),
      makeAssistantTextItem({ id: 'assistant', threadId, turnId: 'turn_only', text: 'hello', status: 'completed' })
    ]
    const result = squashModelContextHistory({ threadId, turnId: 'turn_new', history, nowIso })
    expect(result.baseline).toBeNull()
    expect(result.replacedIds).toEqual([])
  })
})
