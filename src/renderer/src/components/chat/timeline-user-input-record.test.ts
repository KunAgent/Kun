import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { UserInputRecord, userInputRecordLabel, userInputRecordState } from './timeline-user-input-record'

type UserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

const envQuestion = { id: 'env', header: 'Environment', question: 'Where should this deploy first?', options: [] }
const scopeQuestion = { id: 'scope', header: 'Input', question: 'Which parts should migrate?', options: [], selectionMode: 'multiple' as const }

function block(overrides: Partial<UserInputBlock>): UserInputBlock {
  return { kind: 'user_input', id: 'ui_1', requestId: 'req_1', status: 'submitted', questions: [envQuestion], ...overrides }
}

function render(input: UserInputBlock): string {
  return renderToStaticMarkup(createElement(UserInputRecord, { block: input }))
}

describe('ask-user timeline record', () => {
  beforeAll(async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('en')
  })

  it('labels rows with a real header, or with the question when the header is a placeholder', () => {
    expect(userInputRecordLabel(envQuestion)).toBe('Environment')
    expect(userInputRecordLabel(scopeQuestion)).toBe('Which parts should migrate')
  })

  it('only treats a live pending request as waiting; a stale one from history reads as ended', () => {
    expect(userInputRecordState(block({ status: 'pending', live: true })).kind).toBe('waiting')
    expect(userInputRecordState(block({ status: 'pending' })).kind).toBe('ended')
    const html = render(block({ status: 'pending' }))
    expect(html).toContain('data-user-input-record="ended"')
    expect(html).toContain('Cancelled')
    expect(html).not.toContain('Answer below')
  })

  it('points a live request at the card below and counts several questions', () => {
    const one = render(block({ status: 'pending', live: true }))
    expect(one).toContain('Kun is waiting for your answer')
    expect(one).toContain('Answer below')
    // The question stays reachable on hover.
    expect(one).toContain('title="Where should this deploy first?"')
    const many = render(block({ status: 'pending', live: true, questions: [envQuestion, scopeQuestion] }))
    expect(many).toContain('Kun is waiting for your answer · 2 questions')
  })

  it('collapses one answered question to a single line with the answer in ink', () => {
    const html = render(block({ answers: [{ id: 'env', label: 'Staging', value: 'Staging' }] }))
    expect(html).toContain('data-user-input-record="answered-one"')
    expect(html).toContain('Where should this deploy first?')
    expect(html).toContain('<span class="ds-timeline-record-tail ds-timeline-record-ink">Staging</span>')
  })

  it('gives a long question and its answer separate budgets so the answer always shows', () => {
    const question = 'Where should session state live, and which legacy fields have to survive the migration so signed-in users are not logged out?'
    const html = render(block({
      questions: [{ ...envQuestion, question }],
      answers: [{ id: 'env', label: 'Zustand', value: 'Zustand store' }]
    }))
    // The question is cut to one line on its own; the answer clamps in its own
    // element instead of sharing one clamp the question could fill.
    expect(html).toContain('<span class="ds-timeline-record-pair">')
    expect(html).toContain(`<span class="ds-timeline-record-lead ds-timeline-record-muted">${question}</span>`)
    expect(html).toContain('<span class="ds-timeline-record-tail ds-timeline-record-ink">Zustand store</span>')
    expect(html).not.toContain('ds-timeline-record-body')
    const unanswered = render(block({ answers: [] }))
    expect(unanswered).toContain('<span class="ds-timeline-record-tail" data-empty="true">No answer</span>')
  })

  it('renders several answers as a Q -> A grid, joining multi-select values', async () => {
    const input = block({
      questions: [envQuestion, scopeQuestion],
      answers: [
        { id: 'env', label: 'Staging', value: 'Staging' },
        { id: 'scope', label: 'Build, Tests', value: 'Build, Tests', labels: ['Build', 'Tests'], values: ['Build', 'Tests'] }
      ]
    })
    const html = render(input)
    expect(html).toContain('You answered 2 questions')
    expect(html).toContain('<dt title="Where should this deploy first?">Environment</dt>')
    expect(html).toContain('>Build, Tests</dd>')
    await i18n.changeLanguage('zh')
    try {
      const zh = render(input)
      expect(zh).toContain('你回答了 2 个问题')
      expect(zh).toContain('>Build、Tests</dd>')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('marks an unanswered row in a multi-answer card as empty', () => {
    const html = render(block({ questions: [envQuestion, scopeQuestion], answers: [{ id: 'env', label: 'Staging', value: 'Staging' }] }))
    expect(html).toContain('data-empty="true"')
    expect(html).toContain('No answer')
  })

  it('says a skipped or timed-out request ended without an answer, keeping the question faint', () => {
    const skipped = render(block({ status: 'cancelled' }))
    expect(skipped).toContain('You skipped the question')
    expect(skipped).toContain('<span class="ds-timeline-record-faint" data-grow="true">Where should this deploy first?</span>')
    const timeout = render(block({ status: 'timeout' }))
    expect(timeout).toContain('No answer — Kun continued on its own')
    expect(timeout).toContain('data-tone="warning"')
  })

  it('shows an undelivered answer with the error and what the user answered', () => {
    const html = render(block({
      status: 'error',
      errorMessage: 'user input not found',
      answers: [{ id: 'env', label: 'Staging', value: 'Staging' }]
    }))
    expect(html).toContain('data-tone="danger"')
    // A long error is cut to one line (full text on hover) so it cannot hide
    // what the user answered.
    expect(html).toContain('<span class="ds-timeline-record-lead ds-timeline-record-danger" title="Answer not delivered: user input not found">')
    expect(html).toContain('<span class="ds-timeline-record-tail ds-timeline-record-muted">Your answer: Staging</span>')
    const bare = render(block({ status: 'error' }))
    expect(bare).toContain('<span class="ds-timeline-record-body ds-timeline-record-danger">Answer not delivered</span>')
    expect(bare).not.toContain('Your answer')
  })
})
