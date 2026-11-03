import { describe, expect, it } from 'vitest'
import { approvalRequestFromAcp } from '../../../../../kun/src/runtime/acp/acp-permission'
import { approvalToolPresentation } from './approval-tool-presentation'

describe('approval detail projection', () => {
  it('reuses only redacted runtime action data for command, paths and diff preview', () => {
    const approval = approvalRequestFromAcp({ approvalId: 'appr', threadId: 'thread', turnId: 'turn', workspace: '/workspace', params: {
      sessionId: 'session', options: [{ optionId: 'raw-id', name: 'Run it once', kind: 'allow_once' }],
      toolCall: { toolCallId: 'call', title: 'Edit source', kind: 'edit', locations: [{ path: '/workspace/a.ts' }],
        rawInput: { command: 'curl -H "Authorization: Bearer top-secret" https://example.test' },
        content: [{ type: 'diff', path: '/workspace/a.ts', oldText: 'before', newText: 'after' }] }
    } })
    const projection = approvalToolPresentation(approval.action)!
    expect(projection).toMatchObject({ kind: 'edit', canCancel: false, state: 'pending',
      diffs: [{ path: '/workspace/a.ts', oldText: 'before', newText: 'after' }] })
    expect(JSON.stringify(projection)).not.toContain('top-secret')
    expect(approval.action?.permissionOptions).toEqual([{ optionId: 'raw-id', name: 'Run it once', kind: 'allow_once' }])
  })

  it('projects native multi-edit and whole-file write arguments as diffs', () => {
    expect(approvalToolPresentation({ kind: 'file', toolName: 'edit', workspace: '/w',
      arguments: { path: 'src/a.ts', edits: [{ oldText: 'a', newText: 'b' }, { old_string: 'c', new_string: 'd' }] } })?.diffs)
      .toEqual([{ path: 'src/a.ts', oldText: 'a', newText: 'b' }, { path: 'src/a.ts', oldText: 'c', newText: 'd' }])
    expect(approvalToolPresentation({ kind: 'file', toolName: 'Write',
      arguments: { file_path: '/w/new.ts', content: 'export {}\n' } })).toMatchObject({
      kind: 'edit', diffs: [{ path: '/w/new.ts', oldText: null, newText: 'export {}\n' }]
    })
    expect(approvalToolPresentation({ kind: 'mcp', toolName: 'memory_create',
      arguments: { content: 'Prefer pnpm' } })?.diffs).toBeUndefined()
  })

  it('does not invent parameters for historical approvals without an action envelope', () => {
    expect(approvalToolPresentation(undefined)).toBeNull()
  })
})
