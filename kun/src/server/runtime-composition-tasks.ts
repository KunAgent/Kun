import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'
import { publicTaskSuggestion } from '../contracts/task-suggestions.js'
import { FileTaskSuggestionStore } from '../delegation/task-suggestion-store.js'
import { TaskSuggestionService } from '../delegation/task-suggestion-service.js'
import type { createRuntimeModelComposition } from './runtime-composition-model.js'

/** Suggestion cards; thread/turn services are attached once the agent composition exists. */
export function createRuntimeTaskSuggestions(
  model: Awaited<ReturnType<typeof createRuntimeModelComposition>>
): TaskSuggestionService {
  const { core } = model
  return new TaskSuggestionService({
    store: new FileTaskSuggestionStore(core.activeOptions.dataDir),
    // Read per decision: the Settings window applies config without restarting the runtime.
    policy: () => {
      const tasks = core.activeOptions.ade?.tasks
      return { autoStartMs: (tasks?.autoStartSeconds ?? 0) * 1000, worktree: tasks?.worktree ?? true,
        inheritContext: tasks?.inheritContext ?? false }
    },
    onUpdated: async (intent) => {
      await runWithoutTurnMutationFence(() => core.events.record({ kind: 'task_suggestion',
        threadId: intent.source.threadId, taskSuggestion: publicTaskSuggestion(intent) }))
    }
  })
}
