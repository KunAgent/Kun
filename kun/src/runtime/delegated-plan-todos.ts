import {
  MAX_THREAD_TODO_CONTENT_CHARS,
  MAX_THREAD_TODOS,
  type ThreadTodoList,
  type ThreadTodoStatus
} from '../contracts/thread-todos.js'

export type DelegatedPlanEntry = { content: string; status: ThreadTodoStatus }

/**
 * Project an Agent-reported plan onto Kun's thread todo list. Agents may mark
 * several steps in progress at once or send blank steps, while Kun's list
 * keeps at most one in-progress step and rejects blank content. The first
 * in-progress step stays current and later ones read as pending, so a plan
 * mirror never fails the turn on validation.
 */
export function delegatedPlanTodoList(input: {
  threadId: string
  idPrefix: string
  entries: readonly DelegatedPlanEntry[]
  now: string
}): ThreadTodoList {
  let inProgressSeen = false
  const items: ThreadTodoList['items'] = []
  input.entries.forEach((entry, index) => {
    const content = entry.content.trim().slice(0, MAX_THREAD_TODO_CONTENT_CHARS)
    if (!content || items.length >= MAX_THREAD_TODOS) return
    let status = entry.status
    if (status === 'in_progress') {
      if (inProgressSeen) status = 'pending'
      inProgressSeen = true
    }
    items.push({ id: `${input.idPrefix}_${index}`, content, status, createdAt: input.now, updatedAt: input.now })
  })
  return { threadId: input.threadId, items, updatedAt: input.now }
}
