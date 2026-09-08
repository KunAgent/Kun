import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import {
  activeTimelineTurnIndex,
  groupTurns,
  isAppendedUserBlock,
  sameTurnContent,
  stableTurnKey,
  turnTaskSurface
} from './message-timeline-turns'

describe('message timeline turns', () => {
  it('keeps mixed timeline extension context scoped to each durable turn', () => {
    expect(turnTaskSurface({
      user: { kind: 'user', id: 'code', text: 'code', meta: { agentSurface: 'code' } },
      blocks: []
    })).toBe('code')
    expect(turnTaskSurface({
      user: { kind: 'user', id: 'design', text: 'design', meta: { agentSurface: 'design' } },
      blocks: []
    })).toBe('design')
  })
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

  it('aliases a transient background turn id to the active visible turn', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', turnId: 'turn_main', text: 'Run build in background' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_main', text: 'Started.' },
      {
        kind: 'user',
        id: 'notice_1',
        turnId: 'turn_background',
        text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>'
      },
      { kind: 'reasoning', id: 'reasoning_1', turnId: 'turn_background', text: 'Checking.' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.turnId).toBe('turn_main')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual([
      'assistant_1',
      'notice_1',
      'reasoning_1'
    ])
  })

  it('binds live state to the durable active turn before a trailing orphan turn', () => {
    const turns = groupTurns([
      { kind: 'user', id: 'user_1', turnId: 'turn_active', text: 'Implement the plan' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_active', text: 'Working.' },
      { kind: 'assistant', id: 'orphan_1', turnId: 'turn_orphan', text: '' }
    ])

    expect(activeTimelineTurnIndex(turns, 'turn_active', 'user_1')).toBe(0)
    expect(activeTimelineTurnIndex(turns, 'missing', 'missing')).toBe(1)
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

  it('keeps background subagent notices inside the current turn', () => {
    const notice: ChatBlock = {
      kind: 'user',
      id: 'notice_subagent_1',
      text: '<background_subagent_completed><child_id>child-1</child_id><label>后台休眠</label><status>completed</status><summary>done</summary></background_subagent_completed>',
      meta: {
        displayText: 'Background subagent 后台休眠 completed',
        messageSource: 'background_subagent'
      }
    }
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run one background subagent' },
      { kind: 'assistant', id: 'assistant_1', text: 'Started.' },
      notice,
      { kind: 'assistant', id: 'assistant_2', text: 'Background finished.' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.id).toBe('user_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual([
      'assistant_1',
      'notice_subagent_1',
      'assistant_2'
    ])
  })

  it('does not treat ordinary user prompts as background subagent notices', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run one background subagent' },
      { kind: 'assistant', id: 'assistant_1', text: 'Started.' },
      { kind: 'user', id: 'user_2', text: 'Background subagent 后台休眠 completed' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(2)
    expect(turns[1]?.user?.id).toBe('user_2')
  })

  it('keeps internal Graph supervision prompts in the source turn without rendering them as work', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        turnId: 'turn_1',
        text: 'Build the feature.'
      },
      {
        kind: 'user',
        id: 'graph_runtime_1',
        turnId: 'turn_1',
        text: 'Graph Lead supervision for durable run run_1.',
        meta: { messageSource: 'graph_runtime' }
      },
      {
        kind: 'assistant',
        id: 'milestone_1',
        turnId: 'turn_1',
        text: 'The first node passed review.'
      }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.id).toBe('user_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual([
      'graph_runtime_1',
      'milestone_1'
    ])
  })

  it('keeps Design continuation turns auditable without assigning a user bubble', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_brief', turnId: 'turn_spec', text: 'Design a store' },
      { kind: 'assistant', id: 'assistant_spec', turnId: 'turn_spec', text: 'Brief ready' },
      {
        kind: 'user',
        id: 'user_logo_internal',
        turnId: 'turn_logo',
        text: 'Internal logo prompt',
        meta: { messageSource: 'design_continuation' }
      },
      { kind: 'assistant', id: 'assistant_logo', turnId: 'turn_logo', text: 'Logo ready' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(2)
    expect(turns[0]?.user?.id).toBe('user_brief')
    expect(turns[1]?.user).toBeUndefined()
    expect(turns[1]?.blocks.map((block) => block.id)).toEqual([
      'user_logo_internal',
      'assistant_logo'
    ])
  })

  it('merges an admitted optimistic user block with durable blocks from the same turn', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_optimistic',
        text: 'Inspect the request',
        meta: { turnId: 'turn_1' }
      },
      {
        kind: 'reasoning',
        id: 'reasoning_1',
        turnId: 'turn_1',
        text: 'Inspecting the request'
      },
      {
        kind: 'assistant',
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'Inspection complete'
      }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.turnId).toBe('turn_1')
    expect(turns[0]?.user?.id).toBe('user_optimistic')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual([
      'reasoning_1',
      'assistant_1'
    ])
  })

  it('routes a delayed tool update back to its owning turn by turnId', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'First' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'Done first' },
      { kind: 'user', id: 'user_2', turnId: 'turn_2', text: 'Second' },
      { kind: 'assistant', id: 'assistant_2', turnId: 'turn_2', text: 'Done second' },
      {
        kind: 'tool',
        id: 'tool_late',
        turnId: 'turn_1',
        summary: 'late update',
        status: 'success'
      }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(2)
    expect(turns[0]?.turnId).toBe('turn_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual(['assistant_1', 'tool_late'])
    expect(turns[1]?.blocks.map((block) => block.id)).toEqual(['assistant_2'])
  })

  it('keeps a same-turn guided input inside the turn without replacing its owner bubble', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'Build the page' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'Working.' },
      {
        kind: 'user',
        id: 'q-guided',
        turnId: 'turn_1',
        text: 'Use the compact logo instead',
        meta: { displayText: 'Use the compact logo instead' }
      },
      { kind: 'assistant', id: 'assistant_2', turnId: 'turn_1', text: 'Adjusted.' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.id).toBe('user_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual([
      'assistant_1',
      'q-guided',
      'assistant_2'
    ])
    expect(isAppendedUserBlock(turns[0]!.blocks[1]!)).toBe(true)
  })

  it('distinguishes guided user inputs from background and internal notices', () => {
    expect(isAppendedUserBlock({
      kind: 'user',
      id: 'q-guided',
      text: 'keep going'
    })).toBe(true)
    expect(isAppendedUserBlock({
      kind: 'user',
      id: 'notice_shell',
      text: '<background_shell_completed><session_id>abcd1234</session_id></background_shell_completed>',
      meta: { messageSource: 'background_shell' }
    })).toBe(false)
    expect(isAppendedUserBlock({
      kind: 'user',
      id: 'notice_subagent',
      text: '<background_subagent_completed><child_id>child-1</child_id></background_subagent_completed>',
      meta: { messageSource: 'background_subagent' }
    })).toBe(false)
    expect(isAppendedUserBlock({
      kind: 'user',
      id: 'graph_runtime_1',
      text: 'Graph Lead supervision for durable run run_1.',
      meta: { messageSource: 'graph_runtime' }
    })).toBe(false)
    expect(isAppendedUserBlock({
      kind: 'user',
      id: 'design_continuation_1',
      text: 'Internal design prompt',
      meta: { messageSource: 'design_continuation' }
    })).toBe(false)
  })
})
