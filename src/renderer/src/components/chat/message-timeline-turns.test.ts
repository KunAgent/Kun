import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { groupTurns, sameTurnContent, stableTurnKey } from './message-timeline-turns'

describe('message timeline turns', () => {
  it('uses stable ids for user and assistant-only turns', () => {
    const blocks: ChatBlock[] = [
      { kind: 'assistant', id: 'assistant_intro', text: 'Welcome' },
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const turns = groupTurns(blocks)

    expect(stableTurnKey(turns[0], 0)).toBe('assistant_intro')
    expect(stableTurnKey(turns[1], 1)).toBe('user_1')
  })

  it('treats rebuilt turn arrays as the same content when block references are unchanged', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const first = groupTurns(blocks)[0]
    const second = groupTurns(blocks)[0]

    expect(first).not.toBe(second)
    expect(sameTurnContent(first, second)).toBe(true)
  })

  it('keeps background shell notices inside the current turn instead of splitting it', () => {
    const notice: ChatBlock = {
      kind: 'user',
      id: 'notice_1',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>',
      meta: { displayText: 'Background shell abcd1234 completed', messageSource: 'background_shell' }
    }
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run build in background' },
      { kind: 'assistant', id: 'assistant_1', text: 'Started.' },
      notice,
      { kind: 'assistant', id: 'assistant_2', text: 'Build finished.' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.id).toBe('user_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual(['assistant_1', 'notice_1', 'assistant_2'])
  })

  it('detects background shell notices from client-inferred xml text', () => {
    const notice: ChatBlock = {
      kind: 'user',
      id: 'notice_2',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>'
    }
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run build in background' },
      notice
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.text).toBe('Run build in background')
    expect(turns[0]?.blocks).toHaveLength(1)
    expect(turns[0]?.blocks[0]?.id).toBe('notice_2')
  })
})
