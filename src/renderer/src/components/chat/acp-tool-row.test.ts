import { describe, expect, it } from 'vitest'
import { chatBlockFromItem, mergeChatBlocks } from '../../agent/kun-mapper'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { readToolPresentation } from '../../agent/tool-presentation'
import type { ToolBlock } from '../../agent/types'
import { summarizeToolBlock, toolNameForBlock } from './message-timeline-process-detail'
import { summarizeProcessWork } from './message-timeline-process-summary'
import { summarizeToolLiveAction } from './message-timeline-tool-action'

const t = (key: string) => key
function stored(kind: string, input: object, name: string | undefined, title: string) {
  const view = { version: 1, source: 'acp', kind, ...(name ? { name } : {}), title, input, canCancel: false }
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

  it('shows the actual action, target and counts for DeepSeek Harness calls reported as other', () => {
    const calls = [stored('other', { command: 'git status', description: 'Check changes' }, undefined, 'bash'),
      stored('other', { file_path: '/repo/image.png' }, undefined, 'read_image'),
      stored('other', { file_path: '/repo/a.ts', old_string: 'before', new_string: 'after' }, undefined, 'edit'),
      stored('other', { file_path: '/repo/b.ts', content: '' }, undefined, 'write'),
      stored('other', { pattern: '*.ts' }, undefined, 'glob')]
    expect(calls.map(block => readToolPresentation(block).kind)).toEqual(['execute', 'read', 'edit', 'edit', 'search'])
    expect(calls.map(toolNameForBlock)).toEqual(['shell', 'read_file', 'edit_file', 'edit_file', 'search_files'])
    expect(calls.map(block => summarizeToolBlock(block, t))).toEqual(['toolBuiltinBash git status', 'toolBuiltinRead /repo/image.png',
      'toolBuiltinEdit /repo/a.ts', 'toolBuiltinEdit /repo/b.ts', 'toolBuiltinGrep *.ts'])
    expect(summarizeToolLiveAction(calls[0], t)).toBe('toolLiveActionRun')
    expect(summarizeProcessWork(calls, t)).toBe('groupReadFile · groupSearchedOnce · groupEditedFiles · groupRanCommand')
  })

  it('preserves explicit kinds and unknown tools instead of guessing from text or arguments', () => {
    for (const block of [stored('other', { command: 'git status' }, undefined, 'bash would be useful'),
      stored('other', { command: 'git status' }, 'custom', 'bash'), stored('other', {}, undefined, 'bash')]) {
      expect(readToolPresentation(block).kind).toBe('other')
    }
    expect(readToolPresentation(stored('fetch', { command: 'git status' }, undefined, 'bash')).kind).toBe('fetch')
  })
})
