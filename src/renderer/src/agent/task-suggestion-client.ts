import {
  TaskSuggestionPublicSchema,
  taskSuggestionPath,
  type TaskSuggestionActionInput,
  type TaskSuggestionActionName,
  type TaskSuggestionView
} from '@shared/task-suggestions'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'
import { runtimeErrorToError } from '@shared/runtime-error'

function parseCard(body: string, fallback: string): TaskSuggestionView {
  return TaskSuggestionPublicSchema.parse(readRuntimeJson<{ taskSuggestion: unknown }>(body, fallback).taskSuggestion)
}

export const taskSuggestionClient = {
  async get(intentId: string): Promise<TaskSuggestionView> {
    const response = await rendererRuntimeClient.runtimeRequest(taskSuggestionPath(intentId), 'GET')
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to load suggested tasks'))
    return parseCard(response.body, 'Invalid suggested tasks')
  },
  async list(threadId: string): Promise<TaskSuggestionView[]> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/task-suggestions?threadId=${encodeURIComponent(threadId)}`, 'GET')
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to load suggested tasks'))
    const raw = readRuntimeJson<{ taskSuggestions?: unknown[] }>(response.body, 'Invalid suggested tasks').taskSuggestions ?? []
    return raw.flatMap((entry) => {
      const parsed = TaskSuggestionPublicSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
  },
  async act(card: Pick<TaskSuggestionView, 'intentId' | 'revision'>, action: TaskSuggestionActionName,
    input: TaskSuggestionActionInput = {}, requestId = crypto.randomUUID()): Promise<TaskSuggestionView> {
    const response = await rendererRuntimeClient.runtimeRequest(`${taskSuggestionPath(card.intentId)}/actions`, 'POST',
      JSON.stringify({ action, expectedRevision: card.revision, requestId, ...input }))
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to update suggested tasks'))
    return parseCard(response.body, 'Invalid suggested tasks')
  }
}

const MAX_CACHED_CARDS = 200
const cache = new Map<string, TaskSuggestionView>()
const listeners = new Set<() => void>()
let version = 0

export function publishTaskSuggestion(value: unknown): TaskSuggestionView | undefined {
  const result = TaskSuggestionPublicSchema.safeParse(value)
  if (!result.success) return undefined
  const card = result.data
  const existing = cache.get(card.intentId)
  if (existing && existing.revision >= card.revision) return existing
  cache.delete(card.intentId)
  cache.set(card.intentId, card)
  if (cache.size > MAX_CACHED_CARDS) cache.delete(cache.keys().next().value!)
  version += 1
  for (const listener of listeners) listener()
  return card
}

export const taskSuggestionCache = {
  get: (id: string): TaskSuggestionView | undefined => cache.get(id),
  /** Cards whose suggesting conversation is `threadId`, oldest first. */
  forThread: (threadId: string): TaskSuggestionView[] =>
    [...cache.values()].filter((card) => card.source.threadId === threadId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  version: (): number => version,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}
