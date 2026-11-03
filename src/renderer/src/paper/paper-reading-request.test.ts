import { describe, expect, it } from 'vitest'
import { PAPER_READING_PURPOSES, paperReadingQuestion } from './paper-reading-request'

const input = { background: 'ML researcher', goal: 'Small-model code search', question: 'Does it preserve negation?', limited: false }
describe('bounded paper reading purposes', () => {
  it('quick screening is brief, does not require whiteboards, and labels limited material', () => {
    const prompt = paperReadingQuestion('quick-screen', { ...input, limited: true })
    expect(prompt).toContain('Do not make a whiteboard')
    expect(prompt).toContain('limited-material screening')
    expect(prompt).toContain('not reported')
    expect(prompt).toContain('Preserve symbols, units, negation and qualifiers')
  })
  it('methods, reproduction and critique have different outcomes and never execute experiments', () => {
    expect(paperReadingQuestion('method-deep-read', input)).toContain('original notation')
    expect(paperReadingQuestion('method-deep-read', input)).toContain('only if needed')
    expect(paperReadingQuestion('reproduction-prep', input)).toContain('Do not execute or download anything')
    expect(paperReadingQuestion('review-critique', input)).toContain('author-reported statements from your inferences')
  })
  it('lists every purpose once, in menu order', () => {
    expect(PAPER_READING_PURPOSES).toEqual(['quick-screen', 'method-deep-read', 'reproduction-prep', 'review-critique'])
  })
})
