import { describe, expect, it } from 'vitest'
import { makeToolResultItem } from '../domain/item.js'
import { GoalProgressEvidence } from './goal-progress-evidence.js'

function result(toolName: string, output: unknown, isError = false) {
  return { item: makeToolResultItem({ id: 'result', threadId: 'thread', turnId: 'turn',
    callId: 'call', toolName, output, isError }), approved: true }
}
const write = (content: string) => ({ callId: 'call', toolName: 'write', arguments: { path: 'file.txt', content } })

describe('goal outcome evidence', () => {
  it('does not treat reads, searches, successful commands, bookkeeping or arbitrary success as progress', () => {
    const tracker = new GoalProgressEvidence()
    for (const tool of ['read', 'grep', 'web_search', 'exec_command', 'get_goal', 'update_goal', 'create_goal', 'task_create', 'task_update', 'task_get', 'task_list', 'unknown']) {
      tracker.note('turn', tool, result(tool, { success: true, exitCode: 0, path: '/file.txt', content: 'new text' }))
    }
    expect(tracker.hasProgress('turn')).toBe(false)
    expect(tracker.withoutProgress('turn')).toBe(12)
  })

  it('recognizes new file contents and rejects repeated or alternating outputs across continuations', () => {
    const tracker = new GoalProgressEvidence()
    tracker.begin('thread', 'goal-1')
    const output = { path: '/file.txt', bytes_written: 3, changed: true }
    tracker.note('one', 'write', result('write', output), write('one'))
    expect(tracker.hasProgress('one')).toBe(true)
    tracker.clearTurn('one')
    tracker.begin('thread', 'goal-1')
    tracker.note('two', 'write', result('write', output), write('one'))
    expect(tracker.hasProgress('two')).toBe(false)
    tracker.note('two', 'write', result('write', output), write('two'))
    expect(tracker.hasProgress('two')).toBe(true)
    tracker.note('three', 'write', result('write', output), write('one'))
    expect(tracker.hasProgress('three')).toBe(false)
    tracker.begin('thread', 'goal-2')
    tracker.note('four', 'write', result('write', output), write('one'))
    expect(tracker.hasProgress('four')).toBe(true)
  })

  it('requires actual edit evidence and does not credit failures, empty patches or explicit no-ops', () => {
    const tracker = new GoalProgressEvidence()
    for (const output of [{ path: '/file.txt', patch: '' }, { path: '/file.txt', patch: 'diff', changed: false }]) {
      tracker.note('turn', 'edit', result('edit', output))
    }
    tracker.note('turn', 'write', result('write', { path: '/file.txt', bytes_written: 3 }, true), write('one'))
    expect(tracker.hasProgress('turn')).toBe(false)
    tracker.note('turn', 'edit', result('edit', { path: '/file.txt', patch: '@@ -1 +1 @@\n-old\n+new' }))
    expect(tracker.hasProgress('turn')).toBe(true)
    expect(tracker.withoutProgress('turn')).toBe(0)
  })

  it('does not credit first-time no-op writes or unknown change evidence on distinct paths', () => {
    const tracker = new GoalProgressEvidence()
    for (let index = 0; index < 40; index++) {
      tracker.note('turn', 'write', result('write', { path: `/file-${index}.txt`, bytes_written: 3,
        ...(index % 2 ? { changed: false } : {}) }), write('one'))
    }
    expect(tracker.hasProgress('turn')).toBe(false)
    expect(tracker.withoutProgress('turn')).toBe(40)
  })

  it('credits passed project checks once without treating changed log timestamps as new evidence', () => {
    const tracker = new GoalProgressEvidence()
    const checks = [{ command: 'npm', args: ['test'], cwd: '/workspace', label: 'tests', exitCode: 0 }]
    tracker.note('first', 'verify_changes', result('verify_changes', {
      status: 'passed', changed_files: ['file.ts'], checks: [{ ...checks[0], durationMs: 1, output: 'run one' }]
    }))
    expect(tracker.hasProgress('first')).toBe(true)
    tracker.note('next', 'verify_changes', result('verify_changes', {
      status: 'passed', changed_files: ['file.ts'], checks: [{ ...checks[0], durationMs: 2, output: 'run two' }]
    }))
    expect(tracker.hasProgress('next')).toBe(false)
  })
})
