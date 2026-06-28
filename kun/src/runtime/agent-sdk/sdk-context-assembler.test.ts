import { describe, expect, test } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import { buildHistoryTranscript, composeSdkPromptText } from './sdk-context-assembler.js'

function userMsg(turnId: string, text: string): TurnItem {
  return {
    id: `item_${turnId}_${text}`,
    threadId: 'th',
    turnId,
    kind: 'user_message',
    status: 'completed',
    text
  } as unknown as TurnItem
}

function assistantMsg(turnId: string, text: string): TurnItem {
  return {
    id: `item_${turnId}_a`,
    threadId: 'th',
    turnId,
    kind: 'assistant_text',
    status: 'completed',
    text
  } as unknown as TurnItem
}

describe('buildHistoryTranscript', () => {
  test('returns empty string when there is no prior history', () => {
    const items = [userMsg('t2', 'only the current turn')]
    expect(buildHistoryTranscript(items, 't2')).toBe('')
  })

  test('excludes the current turn and renders prior turns as a transcript', () => {
    const items = [
      userMsg('t1', 'first question'),
      assistantMsg('t1', 'first answer'),
      userMsg('t2', 'current question')
    ]
    const transcript = buildHistoryTranscript(items, 't2')
    expect(transcript).toContain('[user] first question')
    expect(transcript).toContain('[assistant] first answer')
    // the live turn's own user text must NOT leak into the replayed history
    expect(transcript).not.toContain('current question')
  })
})

describe('composeSdkPromptText', () => {
  test('collapses to the plain user text when there is no history or instructions', () => {
    expect(composeSdkPromptText({ userText: 'hello' })).toBe('hello')
  })

  test('wraps history, instructions, then the live request last', () => {
    const out = composeSdkPromptText({
      historyTranscript: '[user] earlier\n[assistant] reply',
      userText: 'do the thing',
      instructionBlocks: ['SKILLS: a, b', 'MEMORY: x']
    })
    expect(out).toContain('<prior_conversation>')
    expect(out).toContain('[assistant] reply')
    expect(out).toContain('SKILLS: a, b')
    expect(out).toContain('MEMORY: x')
    expect(out).toContain('Current request:\ndo the thing')
    // history precedes instructions, which precede the live request
    expect(out.indexOf('<prior_conversation>')).toBeLessThan(out.indexOf('SKILLS: a, b'))
    expect(out.indexOf('SKILLS: a, b')).toBeLessThan(out.indexOf('Current request:'))
  })

  test('omits empty sections and skips blank instruction blocks', () => {
    const out = composeSdkPromptText({
      userText: 'hi',
      instructionBlocks: ['', '   ', 'real block']
    })
    expect(out).toContain('real block')
    expect(out).toContain('Current request:\nhi')
    expect(out).not.toContain('<prior_conversation>')
  })
})
