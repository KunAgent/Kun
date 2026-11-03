import { LocalToolHost } from './local-tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { TaskSuggestionService } from '../../delegation/task-suggestion-service.js'
import { publicTaskSuggestion, SuggestTasksInputSchema, TASK_SUGGESTION_MAX_TASKS } from '../../contracts/task-suggestions.js'

type AdmissionContext = Pick<ToolHostContext,
  'harnessId' | 'executionUnitKind' | 'roomAgent' | 'agentSurface' | 'clientSurface' | 'imContext'>

/** Cards render only in the Code workbench of a native Kun conversation. */
export function shouldAdvertiseTaskSuggestions(context: AdmissionContext): boolean {
  return (context.harnessId ?? 'kun') === 'kun' &&
    context.executionUnitKind !== 'worker' &&
    context.roomAgent !== true &&
    (context.agentSurface ?? 'code') === 'code' &&
    context.clientSurface !== 'im' &&
    context.imContext !== true
}

const stringList = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 2000 }, maxItems: 12 }

export function createTaskSuggestionToolProvider(service: TaskSuggestionService): CapabilityToolProvider {
  return { id: 'task-suggestions', kind: 'delegation', enabled: true, available: true, tools: [
    LocalToolHost.defineTool({
      name: 'suggest_tasks',
      description: [
        'Offer the user 2-' + TASK_SUGGESTION_MAX_TASKS + ' independent follow-up tasks as a card.',
        'Each task the user starts runs as its own session nested under this conversation, usually in an isolated git worktree, starting from the brief you write.',
        'Use it after an analysis that found separable pieces of work which do not depend on each other and are each worth a session (not for steps you will do yourself next).',
        'Write each brief so a fresh session can act on it without this conversation: a concrete goal, the files or areas in scope, and checkable completion criteria.',
        'Nothing starts until the user starts it; do not wait for the tasks, and do not repeat the card\'s content in your reply beyond one sentence.'
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', maxLength: 2000, description: 'One sentence on why these can run in parallel.' },
          tasks: {
            type: 'array', minItems: 2, maxItems: TASK_SUGGESTION_MAX_TASKS,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200, description: 'Short outcome-focused title.' },
                area: { type: 'string', maxLength: 200, description: 'Layer or path the task touches, e.g. "backend · kun/src/sessions".' },
                goal: { type: 'string', minLength: 1, maxLength: 8000 },
                scope: { ...stringList, description: 'Concrete changes or files in scope.' },
                done: { ...stringList, description: 'Checkable completion criteria.' },
                worktree: { type: 'boolean', description: 'false only for tasks that must edit the current checkout directly.' },
                profile: { type: 'string', maxLength: 128, description: 'Optional role id from list_subagent_profiles for this session; only roles usable as a primary session.' }
              },
              required: ['title', 'goal'],
              additionalProperties: false
            }
          }
        },
        required: ['tasks'],
        additionalProperties: false
      },
      toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
      shouldAdvertise: shouldAdvertiseTaskSuggestions,
      execute: async (args, context) => {
        const parsed = SuggestTasksInputSchema.safeParse(args)
        if (!parsed.success) {
          return { isError: true, output: { error: 'Invalid task list', issues: parsed.error.issues.slice(0, 8) } }
        }
        const source = await service.describeSource(context.threadId, context.turnId)
        if ('refused' in source) return { isError: true, output: { error: source.refused } }
        const intent = await service.propose({
          source: { threadId: context.threadId, turnId: context.turnId,
            toolCallId: context.activeToolCallId ?? `${context.turnId}:suggest_tasks` },
          workspace: source.workspace, route: source.route, input: parsed.data
        })
        return { output: {
          taskSuggestionId: intent.intentId,
          taskSuggestion: publicTaskSuggestion(intent),
          note: 'The card is shown to the user. Tasks start only when the user starts them; check progress later with task_suggestion_status.'
        } }
      }
    }),
    LocalToolHost.defineTool({
      name: 'task_suggestion_status',
      description: 'Read the suggestion cards of this conversation: which task sessions started, which finished, and their result summaries. Read-only.',
      inputSchema: { type: 'object', properties: { taskSuggestionId: { type: 'string', maxLength: 256 } }, additionalProperties: false },
      toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
      shouldAdvertise: shouldAdvertiseTaskSuggestions,
      execute: async (args, context) => {
        const id = typeof args.taskSuggestionId === 'string' ? args.taskSuggestionId : undefined
        if (!id) return { output: { taskSuggestions: (await service.list(context.threadId)).map(publicTaskSuggestion) } }
        const intent = await service.get(id)
        if (!intent || intent.source.threadId !== context.threadId) {
          return { isError: true, output: { error: 'Suggestion card does not belong to this conversation' } }
        }
        return { output: { taskSuggestion: publicTaskSuggestion(intent) } }
      }
    })
  ] }
}
