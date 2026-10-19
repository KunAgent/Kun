import { describe, expect, it } from 'vitest'
import { buildTranscriptEntries, sameTranscriptEntry, type TranscriptEntry } from './transcript-model.js'
import { fixtureItems as item, fixtureProjection } from './transcript-fixtures.test-support.js'

const options = { showReasoning: false, splitAssistantText: true }

function summary(entries: readonly TranscriptEntry[]): Array<[string, boolean]> {
  return entries.map((entry) => [entry.key, entry.settled])
}

describe('buildTranscriptEntries', () => {
  it('settles everything of a finished turn and labels the Kun reply once', () => {
    const entries = buildTranscriptEntries(fixtureProjection([{
      id: 'turn_1',
      items: [item.user('u1', 'turn_1', 'hi'), item.reasoning('r1', 'turn_1', 'think'), item.text('a1', 'turn_1', 'Hello\n\nWorld')]
    }]), options)
    expect(entries.map((entry) => entry.kind)).toEqual(['item', 'reply-header', 'item', 'item', 'item'])
    expect(entries.every((entry) => entry.settled)).toBe(true)
    expect(entries[0]!.separated).toBe(true)
  })

  it('streams split Markdown: only the growing tail stays live and shows the cursor', () => {
    const entries = buildTranscriptEntries(fixtureProjection([{
      id: 'turn_1',
      running: true,
      items: [item.user('u1', 'turn_1', 'hi'), item.text('a1', 'turn_1', 'Para one\n\n1. a\n2. b\n', 'running')]
    }]), options)
    const blocks = entries.filter((entry) => entry.kind === 'item' && entry.markdown)
    expect(summary(blocks)).toEqual([['a1#0', true], ['a1#1', false]])
    expect(blocks.map((entry) => entry.kind === 'item' && entry.markdown?.streaming)).toEqual([false, true])
  })

  it('settles assistant text once a later item of the same turn exists', () => {
    const entries = buildTranscriptEntries(fixtureProjection([{
      id: 'turn_1',
      running: true,
      items: [
        item.user('u1', 'turn_1', 'hi'),
        item.text('a1', 'turn_1', 'Let me check.', 'running'),
        item.call('c1', 'turn_1', 'bash', { command: 'echo hi' })
      ]
    }]), options)
    const text = entries.find((entry) => entry.key === 'a1#0')
    expect(text).toMatchObject({ settled: true, markdown: { streaming: false } })
    expect(entries.find((entry) => entry.key === 'c1')?.settled).toBe(false)
  })

  it('keeps a tool call live while its result is still streaming', () => {
    const projection = (status: 'running' | 'completed') => fixtureProjection([{
      id: 'turn_1',
      running: true,
      items: [
        item.user('u1', 'turn_1', 'hi'),
        item.call('c1', 'turn_1', 'bash', { command: 'sleep 1' }),
        item.result('c1', 'turn_1', 'bash', 'partial output', status)
      ]
    }])
    const live = buildTranscriptEntries(projection('running'), options).find((entry) => entry.key === 'c1')
    expect(live).toMatchObject({ settled: false, toolResult: { status: 'running' } })
    expect(buildTranscriptEntries(projection('completed'), options).find((entry) => entry.key === 'c1')?.settled).toBe(true)
  })

  it('waits for the result of a failed call so the reason is printed with it', () => {
    const entries = buildTranscriptEntries(fixtureProjection([{
      id: 'turn_1',
      running: true,
      items: [item.user('u1', 'turn_1', 'hi'), item.call('c1', 'turn_1', 'write', { path: 'a' }, 'failed')]
    }]), options)
    expect(entries.find((entry) => entry.key === 'c1')?.settled).toBe(false)
  })

  it('keeps trailing exploration of the running turn live until a closing item arrives', () => {
    const entries = buildTranscriptEntries(fixtureProjection([{
      id: 'turn_1',
      running: true,
      items: [
        item.user('u1', 'turn_1', 'hi'),
        item.call('c1', 'turn_1', 'read', { path: 'README.md' }, 'completed'),
        item.result('c1', 'turn_1', 'read', 'readme')
      ]
    }]), options)
    const unsettled = entries.filter((entry) => !entry.settled).map((entry) => entry.kind)
    expect(unsettled.length).toBeGreaterThan(0)
    expect(entries.find((entry) => entry.kind === 'item' && entry.item.kind === 'user_message')?.settled).toBe(true)
  })

  it('treats rebuilt entries with the same items as unchanged', () => {
    const user = item.user('u1', 'turn_1', 'hi')
    const first = buildTranscriptEntries(fixtureProjection([{ id: 'turn_1', running: true, items: [user, item.text('a1', 'turn_1', 'One\n\nTw', 'running')] }]), options)
    const second = buildTranscriptEntries(fixtureProjection([{ id: 'turn_1', running: true, items: [user, item.text('a1', 'turn_1', 'One\n\nTwo', 'running')] }]), options)
    const byKey = (entries: readonly TranscriptEntry[], key: string) => entries.find((entry) => entry.key === key)!
    expect(sameTranscriptEntry(byKey(first, 'u1'), byKey(second, 'u1'))).toBe(true)
    expect(sameTranscriptEntry(byKey(first, 'a1#0'), byKey(second, 'a1#0'))).toBe(true)
    expect(sameTranscriptEntry(byKey(first, 'a1#1'), byKey(second, 'a1#1'))).toBe(false)
  })
})
