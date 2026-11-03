import { describe, expect, it } from 'vitest'
import { buildTranscriptEntries, type TranscriptEntry } from './transcript-model.js'
import { fixtureItems as item, fixtureProjection } from './transcript-fixtures.test-support.js'
import {
  foldWorkTrails,
  reasoningSummary,
  summarizeWorkTrail,
  toolCategory,
  withPartSpacing,
  withTurnFooters,
  workTrailLabel,
  type WorkTrailSummary
} from './transcript-trail.js'

const options = { showReasoning: false, splitAssistantText: true }
const closed = { expandAll: false, expanded: new Set<string>() }

function bashTurn(id: string, opts: { running?: boolean; failSecond?: boolean } = {}) {
  return {
    id,
    ...(opts.running ? { running: true } : {}),
    items: [
      item.user(`${id}_u`, id, 'run the checks'),
      item.text(`${id}_a`, id, 'Running the checks.'),
      item.call(`${id}_c1`, id, 'bash', { command: 'npm test' }, 'completed'),
      item.result(`${id}_c1`, id, 'bash', { exitCode: 0 }),
      item.call(`${id}_c2`, id, 'edit_file', { path: 'a.ts' }, opts.failSecond ? 'failed' : 'completed'),
      item.result(`${id}_c2`, id, 'edit_file', { ok: !opts.failSecond }, 'completed', Boolean(opts.failSecond)),
      item.text(`${id}_b`, id, 'All green.')
    ]
  }
}

function shape(turns: Parameters<typeof fixtureProjection>[0], fold = closed): TranscriptEntry[] {
  const projection = fixtureProjection(turns)
  return withPartSpacing(foldWorkTrails(withTurnFooters(buildTranscriptEntries(projection, options), projection), projection, fold))
}

function emptySummary(): WorkTrailSummary {
  return { read: 0, search: 0, edit: 0, run: 0, fetch: 0, agents: 0, other: 0, thoughtMs: 0, durationMs: 0 }
}

describe('toolCategory', () => {
  it('sorts tool names into the trail categories', () => {
    expect(toolCategory('bash')).toBe('run')
    expect(toolCategory('exec_command')).toBe('run')
    expect(toolCategory('read_file')).toBe('read')
    expect(toolCategory('grep')).toBe('search')
    expect(toolCategory('glob')).toBe('search')
    expect(toolCategory('edit_file')).toBe('edit')
    expect(toolCategory('write')).toBe('write')
    expect(toolCategory('web_fetch')).toBe('fetch')
    expect(toolCategory('delegate_task')).toBe('agent')
    expect(toolCategory('todo_update')).toBe('other')
  })
})

describe('work trails', () => {
  it('folds the settled tool work of a finished turn into one line and closes it with a footer', () => {
    const entries = shape([bashTurn('turn_1')])
    expect(entries.map((entry) => entry.kind === 'item' ? entry.item.kind : entry.kind)).toEqual([
      'user_message', 'reply-header', 'assistant_text', 'work', 'assistant_text', 'turn-footer'
    ])
    const work = entries.find((entry) => entry.kind === 'work')!
    expect(work.kind === 'work' && work.trail).toMatchObject({ run: 1, edit: 1 })
    expect(work.kind === 'work' && work.expanded).toBe(false)
    const footer = entries.at(-1)!
    expect(footer).toMatchObject({ kind: 'turn-footer', key: 'turn-footer:turn_1', outcome: 'completed', separated: true })
  })

  it('keeps a trail the reader opened, and folds nothing with tool details on', () => {
    const folded = shape([bashTurn('turn_1')])
    const key = folded.find((entry) => entry.kind === 'work')!.key
    const opened = shape([bashTurn('turn_1')], { expandAll: false, expanded: new Set([key]) })
    const index = opened.findIndex((entry) => entry.kind === 'work')
    expect(opened[index]).toMatchObject({ kind: 'work', expanded: true })
    expect(opened.slice(index + 1, index + 3).map((entry) => entry.key)).toEqual(['turn_1_c1', 'turn_1_c2'])
    const all = shape([bashTurn('turn_1')], { expandAll: true, expanded: new Set() })
    expect(all.some((entry) => entry.kind === 'work')).toBe(false)
    expect(all.at(-1)!.kind).toBe('turn-footer')
  })

  it('leaves failed steps visible and does not fold a lone step', () => {
    const entries = shape([bashTurn('turn_1', { failSecond: true })])
    const keys = entries.map((entry) => entry.key)
    expect(entries.some((entry) => entry.kind === 'work')).toBe(false)
    expect(keys).toContain('turn_1_c1')
    expect(keys).toContain('turn_1_c2')
  })

  it('leaves the running turn alone', () => {
    const entries = shape([bashTurn('turn_1'), bashTurn('turn_2', { running: true })])
    const second = entries.filter((entry) => entry.key.includes('turn_2'))
    expect(second.some((entry) => entry.kind === 'work' || entry.kind === 'turn-footer')).toBe(false)
    expect(entries.filter((entry) => entry.kind === 'turn-footer').map((entry) => entry.key)).toEqual(['turn-footer:turn_1'])
  })

  it('sets work rows apart from the prose around them', () => {
    const entries = shape([bashTurn('turn_1')])
    const work = entries.findIndex((entry) => entry.kind === 'work')
    expect(entries[work]!.separated).toBe(true)
    expect(entries[work + 1]!.separated).toBe(true)
  })
})

describe('trail labels', () => {
  it('lists only the categories that happened', () => {
    expect(workTrailLabel(emptySummary())).toBe('Worked')
    const label = workTrailLabel({ ...emptySummary(), durationMs: 2_300, read: 4, run: 1, agents: 2, thoughtMs: 200 })
    expect(label).toMatch(/^Worked 2\.3s · read 4 · run 1 · 2 agents · thought 0\.2s$/u)
  })

  it('counts calls and measures the time a run spans', () => {
    const projection = fixtureProjection([bashTurn('turn_1')])
    const entries = buildTranscriptEntries(projection, options).filter((entry) => entry.kind === 'item' && entry.item.kind === 'tool_call')
    expect(summarizeWorkTrail(entries)).toMatchObject({ run: 1, edit: 1, durationMs: 0 })
  })

  it('summarizes reasoning by its first line without Markdown emphasis', () => {
    expect(reasoningSummary('\n**Planning** the change\nsecond line')).toBe('Planning the change')
    expect(reasoningSummary('## Heading')).toBe('Heading')
    expect(reasoningSummary('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
