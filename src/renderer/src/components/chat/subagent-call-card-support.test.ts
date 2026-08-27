import { describe, expect, it } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import {
  parseDelegateDetail,
  parseFastContextEvidencePack,
  resolveStatus,
  type ChildMeta
} from './subagent-call-card-support'

describe('parseDelegateDetail', () => {
  it('reads the generated role name from the direct generated-agent result', () => {
    expect(parseDelegateDetail(JSON.stringify({
      profile: 'generated:ipc-investigator:12345678',
      profileName: 'IPC Investigator',
      model: 'gpt-5.6-sol',
      generatedAgent: { name: 'IPC Investigator' }
    }))).toMatchObject({
      generated: true,
      generatedAgentName: 'IPC Investigator',
      profileName: 'IPC Investigator',
      model: 'gpt-5.6-sol'
    })
  })

  it('falls back to the generated role snapshot embedded in routing metadata', () => {
    expect(parseDelegateDetail(JSON.stringify({
      profile: 'generated:browser-qa:12345678',
      routing: {
        selectedKind: 'generated',
        agent: { name: 'Browser QA Specialist' }
      }
    }))).toMatchObject({
      generated: true,
      generatedAgentName: 'Browser QA Specialist'
    })
  })

  it('reads fast_context title and query from the tool payload', () => {
    expect(parseDelegateDetail(JSON.stringify({
      childId: 'child_explore',
      status: 'running',
      title: 'Voice transcription flow',
      query: 'Find how speech transcription is wired',
      profile: 'explore'
    }))).toMatchObject({
      childId: 'child_explore',
      status: 'running',
      title: 'Voice transcription flow',
      query: 'Find how speech transcription is wired',
      profile: 'explore'
    })
  })

  it('normalizes a single Fast Context child and bounded evidence pack', () => {
    const detail = JSON.stringify({
      status: 'completed',
      label: 'Fast Context retrieval',
      child: {
        childId: 'child_fast_context',
        status: 'completed',
        profile: 'explore',
        profileName: 'Repository Explorer',
        model: 'gpt-5.6-mini'
      },
      evidencePack: {
        version: 1,
        tasks: [{
          index: 0,
          title: 'Trace renderer',
          query: 'Find the explore card',
          evidence: [{
            path: 'src/renderer/src/components/chat/SubagentCallCard.tsx',
            ranges: [[42, 93]],
            excerpt: 'export function SubagentCallCard',
            reason: 'Renders the child session card'
          }],
          conclusion: 'The card is the integration point.',
          uncertainties: ['No dedicated evidence view yet.']
        }],
        uncertainties: ['Runtime shape may evolve.']
      }
    })

    expect(parseDelegateDetail(detail)).toMatchObject({
      childId: 'child_fast_context',
      status: 'completed',
      title: 'Fast Context retrieval',
      profile: 'explore',
      model: 'gpt-5.6-mini'
    })
    expect(parseFastContextEvidencePack(detail)).toMatchObject({
      version: 1,
      evidenceCount: 1,
      tasks: [{ title: 'Trace renderer', evidence: [{ path: 'src/renderer/src/components/chat/SubagentCallCard.tsx' }] }]
    })
  })

  it('ignores malformed Fast Context evidence instead of throwing', () => {
    expect(parseFastContextEvidencePack(JSON.stringify({
      evidencePack: { version: 1, tasks: [{ index: 0, title: 'Missing query', evidence: [] }] }
    }))).toBeUndefined()
  })
})

describe('resolveStatus', () => {
  it('keeps a detached running child live after its wrapper tool succeeds', () => {
    const block = toolBlock('success', { childId: 'child_live', status: 'running', detached: true })
    const child: ChildMeta = { childId: 'child_live', childStatus: 'running', detached: true }

    expect(resolveStatus(block, child, parseDelegateDetail(block.detail))).toBe('running')
  })

  it.each([
    ['completed', 'done'],
    ['failed', 'failed'],
    ['aborted', 'failed']
  ] as const)('uses detached child terminal status %s', (childStatus, expected) => {
    const block = toolBlock('success', { childId: 'child_terminal', status: childStatus, detached: true })
    expect(resolveStatus(block, {
      childId: 'child_terminal', childStatus, detached: true
    }, parseDelegateDetail(block.detail))).toBe(expected)
  })

  it('shows a user-stopped detached child as stopped', () => {
    const block = toolBlock('error', {
      childId: 'child_stopped', status: 'aborted', detached: true, terminationReason: 'user_stop'
    })
    expect(resolveStatus(block, {
      childId: 'child_stopped', childStatus: 'aborted', detached: true,
      childTerminationReason: 'user_stop'
    }, parseDelegateDetail(block.detail))).toBe('stopped')
  })

  it('keeps foreground and legacy wrapper status fallbacks', () => {
    const foreground = toolBlock('success', { childId: 'child_foreground', status: 'running' })
    expect(resolveStatus(foreground, {
      childId: 'child_foreground', childStatus: 'running'
    }, parseDelegateDetail(foreground.detail))).toBe('done')
    expect(resolveStatus(toolBlock('success'), {})).toBe('done')
    expect(resolveStatus(toolBlock('error'), {})).toBe('failed')
  })

  it('treats a failed fast_context detail whose error self-describes completion as done', () => {
    const block = toolBlock('error', {
      childId: 'child_bad_record',
      status: 'failed',
      error: 'status: completed childId: child_bad_record toolInvocations: 6 resumabl...',
      evidencePack: {
        version: 1,
        tasks: [{ index: 0, title: 'Trace', query: 'Find', evidence: [], uncertainties: [] }],
        uncertainties: []
      }
    })
    expect(resolveStatus(block, {}, parseDelegateDetail(block.detail))).toBe('done')
  })

  it('keeps a contradictory failed detail failed when no evidence pack exists', () => {
    const block = toolBlock('error', {
      childId: 'child_no_pack',
      status: 'failed',
      error: 'status: completed childId: child_no_pack toolInvocations: 6 resumabl...'
    })
    expect(resolveStatus(block, {}, parseDelegateDetail(block.detail))).toBe('failed')
  })

  it('keeps genuine failed details failed', () => {
    const block = toolBlock('error', {
      childId: 'child_genuine',
      status: 'failed',
      error: 'model provider returned HTTP 520'
    })
    expect(resolveStatus(block, {}, parseDelegateDetail(block.detail))).toBe('failed')
  })
})

function toolBlock(status: ToolBlock['status'], detail?: Record<string, unknown>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_delegate',
    summary: 'delegate_task',
    status,
    toolKind: 'tool_call',
    ...(detail ? { detail: JSON.stringify(detail) } : {}),
    meta: { toolName: 'delegate_task' }
  }
}
