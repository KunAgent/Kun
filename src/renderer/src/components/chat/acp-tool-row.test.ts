import { describe, expect, it } from 'vitest'
import { chatBlockFromItem, mergeChatBlocks } from '../../agent/kun-mapper'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { readToolPresentation } from '../../agent/tool-presentation'
import type { ToolBlock } from '../../agent/types'
import { summarizeToolBlock } from './message-timeline-process-detail'

const t = (key: string) => key
function stored(kind: string, input: object, name: string, title: string) {
  const view = { version: 1, source: 'acp', kind, name, title, input, canCancel: false }
  const base = { threadId: 'thread', turnId: 'turn', callId: 'call_123', role: 'tool', createdAt: '2026-11-18T13:32:30Z',
    toolKind: 'tool_call', toolName: 'acp:' + kind } as const
  const item = (entry: Partial<CoreTurnItemJson>, state: string) => chatBlockFromItem({
    ...base, id: state, status: 'completed', kind: 'tool_call', ...entry,
    meta: { delegatedTool: { ...view, state }, toolPresentation: { ...view, state } }
  }) as ToolBlock
  return mergeChatBlocks([item({ arguments: { kind, title, rawInput: input }, status: 'running' }, 'running'),
    item({ kind: 'tool_result', output: '' }, 'completed')])[0] as ToolBlock
}

describe('ACP process rows from saved call/result pairs', () => {
  it('shows the tool and the purpose of an Antigravity MCP call instead of its coarse kind', () => {
    const input = { args: ['--short', '--branch'], operation: 'status', toolSummary: 'Check git status and branch' }
    const block = stored('other', input, 'mcp_kun-tools_git_inspect', 'Run mcp_kun-tools_git_inspect')
    expect(summarizeToolBlock(block, t)).toBe('git_inspect · Check git status and branch')
    expect(readToolPresentation(block)).toMatchObject({ kind: 'mcp', server: 'kun-tools', name: 'git_inspect', input })
    expect(readToolPresentation(block).output).toBeUndefined()
  })

  it('uses an opaque tool title without a summary and retains native file and command targets', () => {
    expect(summarizeToolBlock(stored('other', {}, 'custom', 'Index documentation'), t)).toContain('Index documentation')
    const read = readToolPresentation(stored('read', { Path: '/repo/a.ts', StartLine: 12 }, 'read_file', 'File a.ts'))
    expect(read).toMatchObject({ filePath: '/repo/a.ts', line: 12 })
    expect(read.fileContent).toBeUndefined()
    expect(readToolPresentation(stored('execute', { CommandLine: 'npm test', Cwd: '/repo' }, 'run_command', 'Test')))
      .toMatchObject({ command: 'npm test', cwd: '/repo' })
  })
})
