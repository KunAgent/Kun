import { z } from 'zod'
import { RuntimeEventBase } from './runtime-event-base.js'
import { TaskSuggestionIntentPublicSchema } from './task-suggestions.js'

/** Recorded on the suggesting thread whenever its card changes. */
export const TaskSuggestionEvent = RuntimeEventBase.extend({
  kind: z.literal('task_suggestion'),
  taskSuggestion: TaskSuggestionIntentPublicSchema
})
