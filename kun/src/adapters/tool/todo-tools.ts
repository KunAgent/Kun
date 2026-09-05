import type { SetThreadTodosRequest, ThreadTodoList } from '../../contracts/threads.js'
import type { ThreadService } from '../../services/thread-service.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const TODO_LIST_TOOL_NAME = 'todo_list'
export const TODO_WRITE_TOOL_NAME = 'todo_write'
export const TODO_TOOL_NAMES = [TODO_LIST_TOOL_NAME, TODO_WRITE_TOOL_NAME] as const

export function buildTodoLocalTools(threadService: ThreadService): LocalTool[] {
  return [
    createTodoListTool(threadService),
    createTodoWriteTool(threadService)
  ]
}

function createTodoListTool(threadService: ThreadService): LocalTool {
  return LocalToolHost.defineTool({
    name: TODO_LIST_TOOL_NAME,
    description: 'Return the current thread todo list. Use this to inspect structured progress state.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    policy: 'auto',
    sideEffect: 'read-only',
    toolKind: 'tool_call',
    execute: async (_args, context) => {
      const todos = await threadService.getTodos(context.threadId)
      return { output: todoResponse(todos) }
    }
  })
}

function createTodoWriteTool(threadService: ThreadService): LocalTool {
  return LocalToolHost.defineTool({
    name: TODO_WRITE_TOOL_NAME,
    description: [
      'Replace the current thread todo list with the supplied full list.',
      'Use it for visible task tracking in both Agent and Plan modes.',
      'Call todo_list first when updating an existing list and reuse stable ids; plan linkage is managed internally.',
      'At most one item may be in_progress; if more than one is supplied, only the first in_progress item is kept active.',
      'In Plan mode, save implementation plans with the advertised plan-saving tool; todo_write only updates the progress list.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Complete replacement todo table for this thread.',
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed']
              }
            },
            required: ['content', 'status'],
            additionalProperties: false
          }
        }
      },
      required: ['todos'],
      additionalProperties: false
    },
    policy: 'auto',
    toolKind: 'tool_call',
    execute: async (args, context) => {
      if (!Array.isArray(args.todos)) {
        return { output: { error: 'todos must be an array' }, isError: true }
      }
      if (args.todos.some((todo) => isRecord(todo) && Object.hasOwn(todo, 'source'))) {
        return {
          output: { error: 'todo source is managed internally and cannot be written by todo_write' },
          isError: true
        }
      }
      try {
        const todos = await threadService.setTodosFromTool(context.threadId, {
          todos: normalizeToolTodos(args.todos as SetThreadTodosRequest['todos'])
        })
        return { output: todoResponse(todos) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: { error: message }, isError: true }
      }
    }
  })
}

function normalizeToolTodos(
  todos: SetThreadTodosRequest['todos']
): SetThreadTodosRequest['todos'] {
  let activeSeen = false
  return todos.map((todo) => {
    if (todo.status !== 'in_progress') return todo
    if (!activeSeen) {
      activeSeen = true
      return todo
    }
    return { ...todo, status: 'pending' }
  })
}

function todoResponse(todos: ThreadTodoList | null): {
  todos: { items: Array<{ id: string; content: string; status: string }> } | null
} {
  return {
    todos: todos
      ? {
          items: todos.items.map((item) => ({
            id: item.id,
            content: item.content,
            status: item.status
          }))
        }
      : null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
