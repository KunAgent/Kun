import { describe, expect, it, vi } from 'vitest'
import { InMemoryTaskSuggestionStore } from '../../delegation/task-suggestion-store.js'
import { TaskSuggestionService } from '../../delegation/task-suggestion-service.js'
import type { TaskSuggestionLauncher } from '../../delegation/task-suggestion-launcher.js'
import { createTaskSuggestionToolProvider, shouldAdvertiseTaskSuggestions } from './task-suggestion-tool-provider.js'

type Tool = { name: string; execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<{ isError?: boolean; output: Record<string, unknown> }> }

function setup(describeSource: TaskSuggestionLauncher['describeSource']) {
  const service = new TaskSuggestionService({ store: new InMemoryTaskSuggestionStore(), newId: () => 'tsg_tool' })
  service.attach({ describeSource, launch: vi.fn(), inspect: vi.fn() } as unknown as TaskSuggestionLauncher)
  const tools = createTaskSuggestionToolProvider(service).tools as unknown as Tool[]
  return { service, suggest: tools.find((tool) => tool.name === 'suggest_tasks')!, status: tools.find((tool) => tool.name === 'task_suggestion_status')! }
}

const context = { threadId: 'thr_parent', turnId: 'turn_1', activeToolCallId: 'call_9' }
const tasks = [{ title: 'A', goal: 'do a' }, { title: 'B', goal: 'do b', worktree: false }]

describe('task suggestion tools', () => {
  it('advertises only on native Kun code conversations', () => {
    expect(shouldAdvertiseTaskSuggestions({})).toBe(true)
    expect(shouldAdvertiseTaskSuggestions({ harnessId: 'claude-code' })).toBe(false)
    expect(shouldAdvertiseTaskSuggestions({ executionUnitKind: 'worker' })).toBe(false)
    expect(shouldAdvertiseTaskSuggestions({ agentSurface: 'write' })).toBe(false)
    expect(shouldAdvertiseTaskSuggestions({ clientSurface: 'im' })).toBe(false)
  })

  it('creates a card carrying the suggesting route and exposes it to the renderer', async () => {
    const { suggest, status } = setup(async () => ({ workspace: '/repo', route: { agentId: 'kun', model: 'm1' } }))
    const result = await suggest.execute({ reason: 'parallel', tasks }, context)
    expect(result.isError).toBeUndefined()
    expect(result.output.taskSuggestionId).toBe('tsg_tool')
    const card = result.output.taskSuggestion as { source: unknown; tasks: { route: unknown; worktree: boolean }[] }
    expect(card.source).toEqual({ threadId: 'thr_parent', turnId: 'turn_1', toolCallId: 'call_9' })
    expect(card.tasks.map((task) => [task.route, task.worktree])).toEqual([[{ agentId: 'kun', model: 'm1' }, true], [{ agentId: 'kun', model: 'm1' }, false]])
    const listed = await status.execute({}, context)
    expect((listed.output.taskSuggestions as unknown[]).length).toBe(1)
    expect((await status.execute({ taskSuggestionId: 'tsg_tool' }, { ...context, threadId: 'other' })).isError).toBe(true)
  })

  it('refuses nested task sessions and malformed input', async () => {
    const { suggest } = setup(async () => ({ refused: 'Only a top-level conversation can suggest task sessions.' }))
    expect((await suggest.execute({ tasks }, context)).output.error).toMatch(/top-level/)
    expect((await suggest.execute({ tasks: [tasks[0]] }, context)).isError).toBe(true)
  })
})
