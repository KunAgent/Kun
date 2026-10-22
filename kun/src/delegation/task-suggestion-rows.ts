import {
  isFinalTaskRowState,
  type SuggestTasksInput,
  type TaskSuggestionCardState,
  type TaskSuggestionIntent,
  type TaskSuggestionRoute,
  type TaskSuggestionTask,
  type TaskSuggestionTaskChanges
} from '../contracts/task-suggestions.js'

/** Card phase from its rows; pre-start phases (suggested/countdown/paused) are kept as given. */
export function deriveCardState(intent: Pick<TaskSuggestionIntent, 'state' | 'tasks'>): TaskSuggestionCardState {
  const tasks = intent.tasks
  if (tasks.every((task) => isFinalTaskRowState(task.state))) return 'settled'
  if (tasks.some((task) => task.state !== 'suggested' && task.state !== 'ignored' && task.state !== 'here')) return 'active'
  return intent.state === 'active' || intent.state === 'settled' ? 'suggested' : intent.state
}

/** Rows a start action may take: the named ones, or every still-suggested row. */
export function startableTasks(intent: TaskSuggestionIntent, taskIds?: readonly string[]): TaskSuggestionTask[] {
  const wanted = taskIds?.length ? new Set(taskIds) : undefined
  return intent.tasks.filter((task) => task.state === 'suggested' && (!wanted || wanted.has(task.id)))
}

export function applyTaskChanges(task: TaskSuggestionTask, changes: TaskSuggestionTaskChanges): TaskSuggestionTask {
  return {
    ...task,
    ...(changes.title ? { title: changes.title } : {}),
    ...(changes.route ? { route: changes.route } : {}),
    ...(changes.worktree !== undefined ? { worktree: changes.worktree } : {}),
    ...(changes.inheritContext !== undefined ? { inheritContext: changes.inheritContext } : {}),
    ...(changes.brief ? { brief: changes.brief } : {})
  }
}

/** A fresh attempt: the previous thread and worktree stay where they are, unbound from the row. */
export function resetForRetry(task: TaskSuggestionTask): TaskSuggestionTask {
  const {
    threadId: _thread, turnId: _turn, taskWorkspaceId: _workspace, branch: _branch,
    failure: _failure, result: _result, startedAt: _started, settledAt: _settled, ...rest
  } = task
  return { ...rest, state: 'starting', attempt: task.attempt + 1 }
}

export function tasksFromSuggestion(
  input: SuggestTasksInput,
  defaults: { route: TaskSuggestionRoute; worktree: boolean; inheritContext: boolean }
): TaskSuggestionTask[] {
  return input.tasks.map((task, index) => ({
    id: `t${index + 1}`,
    title: task.title,
    ...(task.area ? { area: task.area } : {}),
    brief: { goal: task.goal, scope: task.scope ?? [], done: task.done ?? [] },
    route: { ...defaults.route },
    worktree: task.worktree ?? defaults.worktree,
    inheritContext: defaults.inheritContext,
    state: 'suggested',
    attempt: 0
  }))
}

/** One line per row for the suggesting thread's dynamic context. */
export function describeTaskRow(task: TaskSuggestionTask, index: number): string {
  const head = `${index + 1}. [${task.state}] ${task.title}`
  const where = task.threadId ? ` (session ${task.threadId}${task.branch ? `, branch ${task.branch}` : ''})` : ''
  const failure = task.failure ? ` — start failed (${task.failure.code}): ${task.failure.message.slice(0, 160)}` : ''
  const result = task.result?.summary ? ` — result: ${task.result.summary.replace(/\s+/g, ' ').slice(0, 280)}` : ''
  const error = task.result?.error ? ` — error: ${task.result.error.replace(/\s+/g, ' ').slice(0, 160)}` : ''
  return `${head}${where}${failure}${result}${error}`
}
