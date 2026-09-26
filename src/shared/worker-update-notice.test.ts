import { describe, expect, it } from 'vitest'
import {
  isWorkerUpdateNoticeUserMessage,
  parseWorkerUpdatesNotice
} from './worker-update-notice'

describe('parseWorkerUpdatesNotice', () => {
  const block = [
    '<kun_worker_updates>',
    '- [Completed] fix login（claude-code · opus） dsp_9',
    '  changes: 3 files +40 −7; verdict: pending',
    '  worker report: patched the redirect',
    '- [Question] pick env q_7',
    '  question: which env? options: staging / prod',
    '</kun_worker_updates>'
  ].join('\n')

  it('parses rendered rows into structured entries', () => {
    const entries = parseWorkerUpdatesNotice(block)
    expect(entries).toHaveLength(2)
    expect(entries?.[0]).toMatchObject({
      status: 'Completed',
      title: 'fix login',
      harnessLabel: 'claude-code · opus',
      ref: 'dsp_9'
    })
    expect(entries?.[0]?.rows).toEqual([
      'changes: 3 files +40 −7; verdict: pending',
      'worker report: patched the redirect'
    ])
    expect(entries?.[1]).toMatchObject({
      status: 'Question',
      title: 'pick env',
      ref: 'q_7'
    })
    expect(entries?.[1]?.rows[0]).toContain('which env?')
  })

  it('parses zh labels and refs without a harness group', () => {
    const zh = '<kun_worker_updates>\n- [完成] 修复登录 dsp_1\n</kun_worker_updates>'
    const entries = parseWorkerUpdatesNotice(zh)
    expect(entries?.[0]).toMatchObject({ status: '完成', title: '修复登录', ref: 'dsp_1' })
  })

  it('unescapes XML entities in dynamic fields', () => {
    const text = '<kun_worker_updates>\n- [Completed] a &lt;b&gt; &amp; c\n</kun_worker_updates>'
    expect(parseWorkerUpdatesNotice(text)?.[0]?.title).toBe('a <b> & c')
  })

  it('returns null for non-notice text and empty blocks', () => {
    expect(parseWorkerUpdatesNotice('hello')).toBeNull()
    expect(parseWorkerUpdatesNotice('<kun_worker_updates></kun_worker_updates>')).toBeNull()
    expect(parseWorkerUpdatesNotice('<kun_worker_updates>\n\n</kun_worker_updates>')).toBeNull()
  })

  it('degrades malformed headers to raw text rows', () => {
    const text = '<kun_worker_updates>\n- unlabeled row\n</kun_worker_updates>'
    const entries = parseWorkerUpdatesNotice(text)
    expect(entries?.[0]?.status).toBe('')
    expect(entries?.[0]?.title).toBe('unlabeled row')
  })
})

describe('isWorkerUpdateNoticeUserMessage', () => {
  it('recognizes the messageSource flag or the notice block', () => {
    expect(isWorkerUpdateNoticeUserMessage({
      text: 'anything',
      meta: { messageSource: 'worker_update' }
    })).toBe(true)
    expect(isWorkerUpdateNoticeUserMessage({
      text: '<kun_worker_updates>\n- [Completed] x\n</kun_worker_updates>'
    })).toBe(true)
    expect(isWorkerUpdateNoticeUserMessage({ text: 'plain user message' })).toBe(false)
  })
})
