import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { buildFastContextEvidencePack } from './fast-context-evidence.js'

const tasks = [
  { title: 'Authentication', query: 'Trace createSession and token validation.' },
  { title: 'Renderer card', query: 'Trace SubagentCallCard rendering.' }
]

function sourceItems(): TurnItem[] {
  return [
    {
      id: 'call_auth', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
      kind: 'tool_call', callId: 'auth', toolName: 'grep', toolKind: 'tool_call', arguments: { pattern: 'createSession' }
    },
    {
      id: 'result_auth', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
      kind: 'tool_result', callId: 'auth', toolName: 'grep', toolKind: 'tool_call', isError: false,
      output: { matches: [{ relative_path: 'src/auth/session.ts', line: 42, text: 'export function createSession() {}' }], command_timed_out: true }
    },
    {
      id: 'call_card', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
      kind: 'tool_call', callId: 'card', toolName: 'read', toolKind: 'tool_call', arguments: { path: 'src/renderer/src/components/chat/SubagentCallCard.tsx' }
    },
    {
      id: 'result_card', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
      kind: 'tool_result', callId: 'card', toolName: 'read', toolKind: 'tool_call', isError: false,
      output: { relative_path: 'src/renderer/src/components/chat/SubagentCallCard.tsx', start_line: 10, end_line: 18, content: 'export function SubagentCallCard() {}', truncated: true }
    }
  ] as TurnItem[]
}

describe('buildFastContextEvidencePack', () => {
  it('associates only positive task matches and retains incomplete-search uncertainty', () => {
    const pack = buildFastContextEvidencePack({ tasks, items: sourceItems(), turnId: 'turn' })
    expect(pack.tasks[0]?.evidence).toEqual([expect.objectContaining({ path: 'src/auth/session.ts', ranges: [[42, 42]] })])
    expect(pack.tasks[1]?.evidence).toEqual([expect.objectContaining({ path: 'src/renderer/src/components/chat/SubagentCallCard.tsx', ranges: [[10, 18]] })])
    expect(pack.tasks[0]?.uncertainties).toContain('Search command timed out; results may be incomplete.')
    expect(pack.tasks[1]?.uncertainties).toContain('Read result was truncated; more source data may be available.')
  })

  it('tells the parent when a search was narrowed to the defining package or hit the candidate limit', () => {
    const items = sourceItems().slice(0, 2).map((item) => item.kind === 'tool_result'
      ? { ...item, output: { matches: [{ relative_path: 'src/auth/session.ts', line: 42, text: 'createSession' }], scope: 'definition_scope', scope_hint: { searched: 'src/auth' }, candidate_files_truncated: true } }
      : item) as TurnItem[]
    const pack = buildFastContextEvidencePack({ tasks: tasks.slice(0, 1), items, turnId: 'turn' })
    expect(pack.tasks[0]?.uncertainties).toEqual(expect.arrayContaining([
      'Search covered only src/auth, where the identifier is defined; references elsewhere were not searched.',
      'Search stopped at its candidate-file limit; ranking may have missed files.'
    ]))
  })

  it('does not assign unrelated evidence when no task term matches', () => {
    const pack = buildFastContextEvidencePack({
      tasks: [
        { title: 'Database migrations', query: 'Find schema migration ownership.' },
        { title: 'Metrics pipeline', query: 'Find telemetry aggregation.' }
      ],
      items: sourceItems(), turnId: 'turn'
    })
    expect(pack.tasks[0]).toMatchObject({ evidence: [], uncertainties: expect.arrayContaining(['No source-tool evidence could be confidently associated with this task.']) })
    expect(pack.tasks[1]).toMatchObject({ evidence: [], uncertainties: expect.arrayContaining(['No source-tool evidence could be confidently associated with this task.']) })
  })

  it('assigns each multi-task candidate once, using the first task for stable ties', () => {
    const pack = buildFastContextEvidencePack({
      tasks: [
        { title: 'Session owner', query: 'Find session validation.' },
        { title: 'Session callers', query: 'Find session refresh.' }
      ],
      items: sourceItems(), turnId: 'turn'
    })
    const sessionEvidence = pack.tasks.flatMap((task) => task.evidence)
      .filter((entry) => entry.path === 'src/auth/session.ts')
    expect(sessionEvidence).toHaveLength(1)
    expect(pack.tasks[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/auth/session.ts' })
    ]))
    expect(pack.tasks[1]?.evidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/auth/session.ts' })
    ]))
  })

  it('keeps a source uncertainty at pack level when no task can own its call', () => {
    const pack = buildFastContextEvidencePack({
      tasks,
      items: [
        {
          id: 'call_glob', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'glob', toolName: 'glob', toolKind: 'tool_call', arguments: { pattern: '**/generated/**' }
        },
        {
          id: 'result_glob', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
          kind: 'tool_result', callId: 'glob', toolName: 'glob', toolKind: 'tool_call', isError: false,
          output: { truncated: true }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    expect(pack.uncertainties).toEqual(expect.arrayContaining([
      'Unattributed source uncertainty: Glob result was truncated; more source data may be available.'
    ]))
    expect(pack.tasks.flatMap((task) => task.uncertainties)).not.toContain(
      'Glob result was truncated; more source data may be available.'
    )
  })

  it('retains failed source-call uncertainty without treating its output as evidence', () => {
    const pack = buildFastContextEvidencePack({
      tasks,
      items: [
        {
          id: 'call_failed', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'failed', toolName: 'grep', toolKind: 'tool_call', arguments: { pattern: 'createSession' }
        },
        {
          id: 'result_failed', threadId: 'child', turnId: 'turn', role: 'tool', status: 'failed', createdAt: 'now',
          kind: 'tool_result', callId: 'failed', toolName: 'grep', toolKind: 'tool_call', isError: true,
          output: { error: 'Fast Context source call exceeded its limit', matches: [{ relative_path: 'src/auth/session.ts', line: 42 }] }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    expect(pack.tasks[0]).toMatchObject({ evidence: [], uncertainties: expect.arrayContaining([
      'Search tool failed: Fast Context source call exceeded its limit'
    ]) })
    expect(pack.tasks.flatMap((task) => task.evidence)).toEqual([])
  })

  it('keeps rejected task_indexes provenance at pack level instead of lexical fallback', () => {
    const pack = buildFastContextEvidencePack({
      tasks,
      items: [
        {
          id: 'call_binding', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'binding', toolName: 'grep', toolKind: 'tool_call', arguments: { pattern: 'createSession' }
        },
        {
          id: 'result_binding', threadId: 'child', turnId: 'turn', role: 'tool', status: 'failed', createdAt: 'now',
          kind: 'tool_result', callId: 'binding', toolName: 'grep', toolKind: 'tool_call', isError: true,
          output: { code: 'fast_context_task_indexes_required', error: 'Fast Context source calls require task_indexes.' }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    expect(pack.tasks[0]?.uncertainties).not.toContain('Search tool failed: Fast Context source calls require task_indexes.')
    expect(pack.uncertainties).toEqual(expect.arrayContaining([
      'Unattributed source uncertainty: Search tool failed: Fast Context source calls require task_indexes.'
    ]))
  })

  it('does not lexically reassign an explicitly invalid task_indexes binding', () => {
    const pack = buildFastContextEvidencePack({
      tasks,
      items: [
        {
          id: 'call_invalid', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'invalid', toolName: 'grep', toolKind: 'tool_call',
          arguments: { pattern: 'createSession', task_indexes: [3] }
        },
        {
          id: 'result_invalid', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
          kind: 'tool_result', callId: 'invalid', toolName: 'grep', toolKind: 'tool_call', isError: false,
          output: { matches: [{ relative_path: 'src/auth/session.ts', line: 42, text: 'export function createSession() {}' }] }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    expect(pack.tasks.flatMap((task) => task.evidence)).toEqual([])
    expect(pack.uncertainties).toContain(
      'Unattributed source uncertainty: Source call had invalid task_indexes; task attribution was withheld.'
    )
  })

  it('parses Markdown task headings in the bounded child conclusion', () => {
    const pack = buildFastContextEvidencePack({
      tasks,
      items: sourceItems(), turnId: 'turn',
      summary: '### Task 1:\nAuth conclusion\n\n**Task 2:**\nRenderer conclusion'
    })
    expect(pack.tasks[0]?.conclusion).toBe('Auth conclusion')
    expect(pack.tasks[1]?.conclusion).toBe('Renderer conclusion')
  })

  it('associates Chinese task terms with Chinese source excerpts without zero-score fallback', () => {
    const pack = buildFastContextEvidencePack({
      tasks: [
        { title: '认证会话', query: '查找会话创建逻辑。' },
        { title: '渲染卡片', query: '查找子代理卡片展示。' }
      ],
      items: [
        {
          id: 'call_chinese', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'chinese', toolName: 'grep', toolKind: 'tool_call', arguments: { pattern: '会话' }
        },
        {
          id: 'result_chinese', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
          kind: 'tool_result', callId: 'chinese', toolName: 'grep', toolKind: 'tool_call', isError: false,
          output: { matches: [{ relative_path: 'src/认证/会话.ts', line: 12, text: 'export function 创建会话() {}' }] }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    expect(pack.tasks[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/认证/会话.ts' })
    ]))
    expect(pack.tasks[1]?.evidence).toEqual([])
  })

  it('uses explicit shared task_indexes before language matching', () => {
    const pack = buildFastContextEvidencePack({
      tasks: [
        { title: '认证会话', query: '查找会话创建逻辑。' },
        { title: '调用位置', query: '查找会话调用方。' }
      ],
      items: [
        {
          id: 'call_explicit', threadId: 'child', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: 'now',
          kind: 'tool_call', callId: 'explicit', toolName: 'grep', toolKind: 'tool_call',
          arguments: { pattern: 'createSession', task_indexes: [1, 2] }
        },
        {
          id: 'result_explicit', threadId: 'child', turnId: 'turn', role: 'tool', status: 'completed', createdAt: 'now',
          kind: 'tool_result', callId: 'explicit', toolName: 'grep', toolKind: 'tool_call', isError: false,
          output: { matches: [{ relative_path: 'src/auth/session.ts', line: 42, text: 'export function createSession() {}' }] }
        }
      ] as TurnItem[], turnId: 'turn'
    })
    for (const task of pack.tasks) {
      expect(task.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'src/auth/session.ts', ranges: [[42, 42]] })
      ]))
    }
  })
})
