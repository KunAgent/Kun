/**
 * External Agent that a scheduled plan build is handed to. Present only on
 * plan builds whose card picked an Agent other than Kun; the run then opens
 * a fresh ADE conversation bound to a host task worktree instead of sending a
 * Kun turn to the source thread.
 */
export type ScheduledTaskHarnessV1 = {
  id: string
  credentialMode?: string
  providerId?: string
  model?: string
  accountId?: string
  reasoningEffort?: string
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeScheduledTaskHarness(value: unknown): ScheduledTaskHarnessV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = text(record.id, 128)
  if (!id || id === 'kun') return undefined
  const optional = (key: keyof ScheduledTaskHarnessV1, max = 256): Partial<ScheduledTaskHarnessV1> => {
    const next = text(record[key], max)
    return next ? { [key]: next } : {}
  }
  return {
    id,
    ...optional('credentialMode', 32),
    ...optional('providerId', 128),
    ...optional('model'),
    ...optional('accountId', 128),
    ...optional('reasoningEffort', 32)
  }
}
