import type { ThreadTodoItem, ThreadTodoList } from '../agent/types'

export function normalizeTodoContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function todoContentHash(value: string): string {
  const normalized = normalizeTodoContent(value).toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function threadTodoWriteItems(
  todos: ThreadTodoList
): Array<Pick<ThreadTodoItem, 'id' | 'content' | 'status' | 'source'>> {
  return todos.items.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
    ...(item.source ? { source: item.source } : {})
  }))
}
