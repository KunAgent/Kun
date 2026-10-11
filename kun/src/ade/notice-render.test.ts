import { describe, expect, it } from 'vitest'
import type { WorkerNotice } from '../contracts/ade.js'
import { renderWorkerUpdates } from './notice-render.js'

const NOW = '2026-09-26T00:00:00.000Z'

function notice(overrides: Partial<WorkerNotice> = {}): WorkerNotice {
  return {
    noticeId: 'ntc_1',
    teamId: 'thr_mgr',
    workerId: 'wrk_1',
    kind: 'dispatch_completed',
    title: 'fix login',
    createdAt: NOW,
    attempts: 0,
    ...overrides
  }
}

describe('renderWorkerUpdates', () => {
  it('wraps notices in a kun_worker_updates block with a display title', () => {
    const rendered = renderWorkerUpdates([notice()], 'en')
    expect(rendered.prompt.startsWith('<kun_worker_updates>\n')).toBe(true)
    expect(rendered.prompt.endsWith('</kun_worker_updates>')).toBe(true)
    expect(rendered.prompt).toContain('- [Completed] fix login')
    expect(rendered.displayText).toBe('1 worker update')
  })

  it('renders zh labels and plural display text', () => {
    const rendered = renderWorkerUpdates([notice(), notice({ noticeId: 'ntc_2' })], 'zh-CN')
    expect(rendered.prompt).toContain('- [完成] fix login')
    expect(rendered.displayText).toBe('2 个 worker 有更新')
  })

  it('renders per-kind labels', () => {
    const rendered = renderWorkerUpdates([
      notice({ kind: 'dispatch_failed' }),
      notice({ noticeId: 'ntc_2', kind: 'question', detail: 'which env?' })
    ], 'en')
    expect(rendered.prompt).toContain('- [Failed] fix login')
    expect(rendered.prompt).toContain('- [Question] fix login')
    expect(rendered.prompt).toContain('question: which env?')
  })

  it('includes the ref id, harness label, capture row, and question options', () => {
    const rendered = renderWorkerUpdates([
      notice({
        dispatchId: 'dsp_9',
        harnessLabel: 'claude-code · opus',
        capture: { changedFiles: 3, insertions: 40, deletions: 7 }
      }),
      notice({
        noticeId: 'ntc_q',
        kind: 'question',
        questionId: 'q_7',
        detail: 'pick one',
        options: ['a', 'b']
      })
    ], 'en')
    expect(rendered.prompt).toContain('fix login（claude-code · opus） dsp_9')
    expect(rendered.prompt).toContain('changes: 3 files +40 −7')
    expect(rendered.prompt).toContain('q_7')
    expect(rendered.prompt).toContain('options: a / b')
  })

  it('escapes XML-sensitive content in dynamic fields', () => {
    const rendered = renderWorkerUpdates([
      notice({ title: 'a <b> & "c"', detail: 'x < y' })
    ], 'en')
    expect(rendered.prompt).toContain('a &lt;b&gt; &amp;')
    expect(rendered.prompt).toContain('x &lt; y')
    expect(rendered.prompt).not.toContain('a <b>')
  })

  it('clips oversized detail', () => {
    const rendered = renderWorkerUpdates([
      notice({ detail: 'x'.repeat(5_000) })
    ], 'en')
    const row = rendered.prompt.split('\n').find((line) => line.includes('worker report:'))!
    expect(row.length).toBeLessThan(1_600)
  })
})
