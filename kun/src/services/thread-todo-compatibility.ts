import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SetThreadTodosRequest, ThreadTodoItem, ThreadTodoList, ThreadTodoSource, ThreadTodoStatus } from '../contracts/threads.js'
import { normalizeTodoContent, normalizePlanRelativePath, todoContentHash } from '../shared/todos.js'

export function normalizeTodoItems(input: {
  rawItems: SetThreadTodosRequest['todos']
  existingItems: readonly ThreadTodoItem[]
  now: string
  ids: IdGenerator
}): ThreadTodoItem[] {
  const existingById = new Map(input.existingItems.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  let inProgressSeen = false
  return input.rawItems.map((raw) => {
    const content = normalizeTodoContent(raw.content)
    if (!content) throw new Error('todo content is required')
    const status = normalizeTodoStatus(raw.status)
    if (status === 'in_progress') {
      if (inProgressSeen) throw new Error('at most one todo can be in_progress')
      inProgressSeen = true
    }
    const source = raw.source ? normalizeTodoSource(raw.source) : undefined
    const requestedId = raw.id?.trim()
    const existing =
      (requestedId ? existingById.get(requestedId) : undefined) ??
      findExistingTodoForRaw(input.existingItems, usedIds, { content, source })
    const id = uniqueTodoId(requestedId || existing?.id || input.ids.next('todo'), usedIds, input.ids)
    const changed =
      !existing ||
      existing.content !== content ||
      existing.status !== status ||
      !sameTodoSource(existing.source, source)
    usedIds.add(id)
    return {
      id,
      content,
      status,
      ...(source ? { source } : {}),
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: changed ? input.now : existing.updatedAt
    }
  })
}

export function preserveToolTodoSources(
  rawItems: SetThreadTodosRequest['todos'],
  existingItems: readonly ThreadTodoItem[]
): SetThreadTodosRequest['todos'] {
  const existingById = new Map(existingItems.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  return rawItems.map((raw) => {
    const content = normalizeTodoContent(raw.content)
    const requestedId = raw.id?.trim()
    let existing = requestedId ? existingById.get(requestedId) : undefined
    if (!existing && !requestedId) {
      const matches = existingItems.filter((item) =>
        !usedIds.has(item.id) && normalizeTodoContent(item.content) === content
      )
      if (matches.length === 1) existing = matches[0]
    }
    if (existing) usedIds.add(existing.id)
    if (
      !existing?.source ||
      normalizeTodoContent(existing.content) !== content
    ) {
      return raw
    }
    return {
      ...raw,
      id: requestedId || existing.id,
      source: existing.source
    }
  })
}

export function normalizeTodoStatus(status: ThreadTodoStatus): ThreadTodoStatus {
  if (status === 'pending' || status === 'in_progress' || status === 'completed') return status
  throw new Error(`unsupported todo status: ${String(status)}`)
}

export function normalizeTodoSource(source: ThreadTodoSource): ThreadTodoSource {
  if (source.kind !== 'plan') throw new Error(`unsupported todo source: ${String(source.kind)}`)
  const relativePath = normalizePlanRelativePath(source.relativePath)
  if (!isGuiPlanRelativePath(relativePath)) {
    throw new Error(`invalid GUI plan relative path: ${source.relativePath}`)
  }
  return {
    kind: 'plan',
    planId: source.planId,
    relativePath,
    ordinal: source.ordinal,
    contentHash: source.contentHash
  }
}

export function findExistingTodoForRaw(
  existingItems: readonly ThreadTodoItem[],
  usedIds: ReadonlySet<string>,
  raw: { content: string; source?: ThreadTodoSource }
): ThreadTodoItem | undefined {
  const candidates = existingItems.filter((item) => !usedIds.has(item.id))
  if (raw.source) {
    return (
      candidates.find((item) => item.source && sameTodoSource(item.source, raw.source)) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.contentHash === raw.source.contentHash
      ) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.ordinal === raw.source.ordinal
      )
    )
  }
  const hash = todoContentHash(raw.content)
  return candidates.find((item) => !item.source && todoContentHash(item.content) === hash)
}

export function sameTodoSource(
  first: ThreadTodoSource | undefined,
  second: ThreadTodoSource | undefined
): boolean {
  if (!first || !second) return !first && !second
  return (
    first.kind === second.kind &&
    first.planId === second.planId &&
    first.relativePath === second.relativePath &&
    first.ordinal === second.ordinal &&
    first.contentHash === second.contentHash
  )
}

export function uniqueTodoId(requested: string, usedIds: Set<string>, ids: IdGenerator): string {
  let candidate = requested.trim()
  while (!candidate || usedIds.has(candidate)) {
    candidate = ids.next('todo')
  }
  return candidate
}

export function cloneTodoListForThread(todos: ThreadTodoList, threadId: string, now: string): ThreadTodoList {
  return {
    threadId,
    items: todos.items.map((item) => ({ ...item })),
    updatedAt: now
  }
}
