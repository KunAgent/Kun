import type { AssistantTaskQuery, AssistantTaskStatus } from '../../shared/assistant-mailbox'
const states: AssistantTaskStatus[] = ['queued', 'sent', 'received', 'working', 'blocked', 'done', 'failed', 'cancel_requested', 'cancelled']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function validTaskQuery(value: unknown): AssistantTaskQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TASK_QUERY')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['assistantId', 'status', 'query', 'from', 'to', 'archived', 'cursor', 'limit'].includes(key))
    || (v.assistantId !== undefined && (typeof v.assistantId !== 'string' || !uuid.test(v.assistantId)))
    || (v.status !== undefined && !states.includes(v.status as AssistantTaskStatus))
    || (v.query !== undefined && (typeof v.query !== 'string' || v.query.length > 500))
    || (v.archived !== undefined && typeof v.archived !== 'boolean')
    || (v.limit !== undefined && (!Number.isInteger(v.limit) || (v.limit as number) < 1 || (v.limit as number) > 50))
    || (v.cursor !== undefined && (typeof v.cursor !== 'string' || v.cursor.length > 80 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[0-9a-f-]{36}$/.test(v.cursor)))
    || ['from', 'to'].some(key => v[key] !== undefined && (typeof v[key] !== 'string' || Number.isNaN(Date.parse(v[key] as string))))) throw new Error('INVALID_TASK_QUERY')
  const query = { ...v } as AssistantTaskQuery
  if (query.from) query.from = new Date(query.from).toISOString()
  if (query.to) query.to = new Date(query.to).toISOString()
  if (query.from && query.to && query.from > query.to) throw new Error('INVALID_TASK_QUERY')
  return query
}
