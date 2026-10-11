import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  makeAssistantTextItem,
  makeCompactionItem,
  makeGoalContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../domain/item.js'
import { buildHandoffBrief, type BuildHandoffInput } from './handoff-brief.js'
import { extractWorkState } from './work-state.js'
import { utf8Bytes } from './utf8-budget.js'
import type { WorkState } from './handoff-types.js'

const THREAD = 'thread_1'

function user(turnId: string, text: string, displayText?: string): TurnItem {
  return makeUserItem({
    id: `${turnId}_u`, threadId: THREAD, turnId, text,
    ...(displayText ? { displayText } : {})
  })
}

function assistant(turnId: string, text: string): TurnItem {
  return makeAssistantTextItem({ id: `${turnId}_a`, threadId: THREAD, turnId, text, status: 'completed' })
}

function toolCall(
  turnId: string,
  callId: string,
  toolName: string,
  toolKind: 'tool_call' | 'command_execution' | 'file_change',
  args: Record<string, unknown>
): TurnItem {
  return makeToolCallItem({
    id: `${callId}_c`, threadId: THREAD, turnId, callId, toolName, toolKind,
    arguments: args, status: 'completed'
  })
}

function toolResult(
  turnId: string,
  callId: string,
  toolName: string,
  output: unknown,
  toolKind: 'tool_call' | 'command_execution' | 'file_change' = 'tool_call'
): TurnItem {
  return makeToolResultItem({
    id: `${callId}_r`, threadId: THREAD, turnId, callId, toolName, toolKind, output
  })
}

const EMPTY_WORK_STATE: WorkState = { files: [], commands: [], todos: [] }

function input(items: TurnItem[], extra: Partial<BuildHandoffInput> = {}): BuildHandoffInput {
  return {
    items,
    currentTurnId: 'turn_current',
    reason: 'harness-switch',
    mode: 'full',
    from: { harnessName: 'Kun', model: 'deepseek-v4-pro' },
    to: { harnessName: 'Claude Code', model: 'claude-opus-4-8' },
    workState: EMPTY_WORK_STATE,
    ...extra
  }
}

describe('buildHandoffBrief', () => {
  it('is deterministic: identical input produces identical bytes', () => {
    const items = [user('t1', '改登录页'), assistant('t1', '已修改 LoginForm')]
    const a = buildHandoffBrief(input(items))
    const b = buildHandoffBrief(input(items))
    expect(a.text).toBe(b.text)
    expect(a.digest).toBe(b.digest)
  })

  it('renders only the frame when there is no history', () => {
    const { text } = buildHandoffBrief(input([]))
    expect(text).toContain('<kun_handoff version="1" reason="harness-switch">')
    expect(text).toContain('来源：Kun（deepseek-v4-pro）→ 接手：Claude Code（claude-opus-4-8）')
    expect(text).toContain('## 工作现场')
    expect(text).toContain('read_thread_history')
    expect(text.trim().endsWith('</kun_handoff>')).toBe(true)
    expect(text).not.toContain('较早的对话')
    expect(text).not.toContain('最近的对话')
  })

  it('keeps the last 4 turns verbatim and digests the 8 older ones', () => {
    const items: TurnItem[] = []
    for (let i = 1; i <= 12; i += 1) {
      items.push(user(`t${i}`, `请求 ${i}`), assistant(`t${i}`, `回复 ${i}`))
    }
    const { text, stats } = buildHandoffBrief(input(items))
    expect(stats.recentTurns).toBe(4)
    expect(stats.digestLines).toBe(8)
    expect(text).toContain('## 较早的对话（摘要）')
    expect(text).toContain('- 第 1 轮 用户：请求 1 ／ 助手：回复 1')
    expect(text).toContain('- 第 8 轮 用户：请求 8 ／ 助手：回复 8')
    expect(text).not.toContain('- 第 9 轮')
    expect(text).toContain('## 最近的对话（原文）')
    expect(text).toContain('### 第 9 轮 用户\n请求 9')
    expect(text).toContain('### 第 12 轮 助手\n回复 12')
    expect(text).not.toContain('### 第 8 轮')
  })

  it('shrinks in order under a tight totalCap and never drops work state', () => {
    const items: TurnItem[] = []
    for (let i = 1; i <= 8; i += 1) {
      items.push(user(`t${i}`, `用户消息 ${i} `.repeat(30)))
      items.push(assistant(`t${i}`, `助手回复 ${i} `.repeat(30)))
    }
    const workState: WorkState = {
      files: ['src/a.ts'], commands: [{ command: 'npm test', exitCode: 0 }],
      todos: ['待办甲'], goal: '当前目标文本'
    }
    const tight = buildHandoffBrief(input(items, {
      workState,
      budgets: { totalCap: 2_000 }
    }))
    const looser = buildHandoffBrief(input(items, {
      workState,
      budgets: { totalCap: 6_000 }
    }))
    expect(utf8Bytes(tight.text)).toBeLessThanOrEqual(2_000)
    // Tighter budget removes content; it never grows.
    expect(tight.text.length).toBeLessThan(looser.text.length)
    expect(tight.text).toContain('## 工作现场')
    expect(tight.text).toContain('src/a.ts')
    expect(tight.text).toContain('待办甲')
    expect(tight.text).toContain('当前目标文本')
    expect(tight.text).toContain('read_thread_history')
    // Digest shrinks before verbatim turns are reduced.
    const tiny = buildHandoffBrief(input(items, {
      workState,
      budgets: { totalCap: 1_200 }
    }))
    expect(utf8Bytes(tiny.text)).toBeLessThanOrEqual(1_200)
    expect(tiny.text).toContain('## 工作现场')
  })

  it('places the compaction summary first inside the digest section', () => {
    const items: TurnItem[] = []
    for (let i = 1; i <= 6; i += 1) {
      items.push(user(`old${i}`, `旧轮 ${i}`), assistant(`old${i}`, `旧回复 ${i}`))
    }
    items.push(makeCompactionItem({
      id: 'comp1', threadId: THREAD, turnId: 'old6',
      summary: '压缩摘要内容：之前讨论了登录改造', replacedTokens: 500,
      pinnedConstraints: []
    }))
    for (let i = 7; i <= 8; i += 1) {
      items.push(user(`t${i}`, `新请求 ${i}`), assistant(`t${i}`, `新回复 ${i}`))
    }
    const { text } = buildHandoffBrief(input(items))
    const digest = text.indexOf('## 较早的对话（摘要）')
    const summaryAt = text.indexOf('压缩摘要内容：之前讨论了登录改造')
    expect(digest).toBeGreaterThan(-1)
    expect(summaryAt).toBeGreaterThan(digest)
    expect(summaryAt).toBeLessThan(text.indexOf('## 最近的对话'))
  })

  it('delta mode only renders turns after sinceTurnId', () => {
    const items: TurnItem[] = []
    for (let i = 1; i <= 5; i += 1) {
      items.push(user(`t${i}`, `第${i}轮`), assistant(`t${i}`, `回复${i}`))
    }
    const delta = buildHandoffBrief(input(items, { mode: 'delta', sinceTurnId: 't3' }))
    expect(delta.text).toContain('你离开期间发生了：')
    expect(delta.text).toContain('第4轮')
    expect(delta.text).toContain('第5轮')
    expect(delta.text).not.toContain('第1轮')
    expect(delta.text).not.toContain('第2轮')
    // Unknown anchor degenerates to the full brief.
    const full = buildHandoffBrief(input(items, { mode: 'delta', sinceTurnId: 'nope' }))
    expect(full.text).toContain('第1轮')
    expect(full.text).not.toContain('你离开期间发生了：')
  })

  it('uses displayText for user messages when present', () => {
    const items = [user('t1', 'raw internal text', '界面显示的话'), assistant('t1', '好的')]
    const { text } = buildHandoffBrief(input(items))
    expect(text).toContain('界面显示的话')
    expect(text).not.toContain('raw internal text')
  })

  it('never splits a multi-byte character when truncating', () => {
    const long = '中'.repeat(100) + '🙂'.repeat(50)
    const items = [user('t1', long), assistant('t1', 'ok')]
    const { text } = buildHandoffBrief(input(items, { budgets: { recentTextCap: 40 } }))
    expect(text).toContain('…（已截断）')
    // Byte-cap truncation via fitUtf8 also stays on code-point boundaries.
    const tiny = buildHandoffBrief(input(items, { budgets: { totalCap: 900 } }))
    expect(() => Buffer.from(tiny.text, 'utf8')).not.toThrow()
    for (const char of tiny.text) {
      expect(char.codePointAt(0)).toBeDefined()
    }
  })
})

describe('extractWorkState', () => {
  it('collects file paths from Kun native, Claude SDK, and ACP shapes', () => {
    const items = [
      toolCall('t1', 'c1', 'write', 'file_change', { path: 'src/kun.ts' }),
      toolCall('t1', 'c2', 'Edit', 'file_change', { file_path: 'src/sdk.ts' }),
      toolCall('t1', 'c3', 'acp_diff', 'file_change', { path: 'src/acp.ts' }),
      toolCall('t1', 'c4', 'mystery_tool', 'file_change', { wat: 'x' }),
      toolCall('t1', 'c5', 'design_canvas', 'file_change', { unrelated: true })
    ]
    const state = extractWorkState(items)
    expect(state.files).toEqual(['src/acp.ts', 'src/kun.ts', 'src/sdk.ts'])
  })

  it('merges task-workspace changedFiles into the file set', () => {
    const items = [toolCall('t1', 'c1', 'write', 'file_change', { path: 'b.ts' })]
    const state = extractWorkState(items, { changedFiles: ['a.ts', 'b.ts'] })
    expect(state.files).toEqual(['a.ts', 'b.ts'])
  })

  it('captures commands with exit codes, newest last, capped at 50', () => {
    const items: TurnItem[] = []
    for (let i = 0; i < 55; i += 1) {
      items.push(
        toolCall('t1', `cmd${i}`, 'bash', 'command_execution', { command: `run ${i}` }),
        toolResult('t1', `cmd${i}`, 'bash', { exitCode: i % 2 }, 'command_execution')
      )
    }
    const state = extractWorkState(items)
    expect(state.commands).toHaveLength(50)
    expect(state.commands[0]!.command).toBe('run 5')
    expect(state.commands.at(-1)).toEqual({ command: 'run 54', exitCode: 0 })
  })

  it('reads open todos from the latest todo_write and the active goal', () => {
    const items = [
      toolCall('t1', 'td1', 'todo_write', 'tool_call', {
        todos: [
          { id: '1', content: '已完成的事', status: 'completed' },
          { id: '2', content: '未完成的事', status: 'in_progress' }
        ]
      }),
      toolCall('t2', 'td2', 'TodoWrite', 'tool_call', {
        todos: [{ id: '3', content: '最新待办', status: 'pending' }]
      }),
      makeGoalContextItem({ id: 'g1', threadId: THREAD, turnId: 't2', text: '  修复登录  ' })
    ]
    const state = extractWorkState(items)
    expect(state.todos).toEqual(['最新待办'])
    expect(state.goal).toBe('修复登录')
  })

  it('keeps the latest create_plan path from successful results', () => {
    const items = [
      toolResult('t1', 'p1', 'create_plan', { relative_path: '.kunsdd/plan/a.md' }),
      toolResult('t2', 'p2', 'create_plan', { error: 'nope' }, 'file_change'),
      toolResult('t2', 'p3', 'create_plan', { absolute_path: '/abs/plan.md' }, 'file_change')
    ]
    const state = extractWorkState(items)
    expect(state.plan).toBe('/abs/plan.md')
  })
})
