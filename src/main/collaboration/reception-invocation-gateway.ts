import type { ReceptionEmployeePublication } from '../../shared/collaboration/contracts'

export type CollaborationRuntimeRequest = (
  path: string,
  init: { method?: string; body?: string }
) => Promise<{ ok: boolean; status: number; body: string }>

type GatewayOptions = {
  runtimeRequest: CollaborationRuntimeRequest
  workspaceRoot: string | (() => Promise<string>)
  localAllowedToolNames: readonly string[]
}

type InvokeInput = {
  publication: ReceptionEmployeePublication
  prompt: string
}

export type ReceptionInvocationStart = {
  status: 'running'
  ownerDeviceId: string
  threadId: string
  turnId: string
  allowedToolNames: string[]
}

export type ReceptionInvocationInspection =
  | { status: 'running' }
  | { status: 'completed'; resultSummary?: string }
  | { status: 'failed'; error?: string }
  | { status: 'interrupted'; error?: string }

export class ReceptionInvocationGateway {
  constructor(private readonly options: GatewayOptions) {}

  async invoke(input: InvokeInput): Promise<ReceptionInvocationStart> {
    const allowedToolNames = intersectToolNames(
      input.publication.allowedToolNames,
      this.options.localAllowedToolNames
    )
    const workspace = typeof this.options.workspaceRoot === 'function'
      ? await this.options.workspaceRoot()
      : this.options.workspaceRoot
    const thread = await this.requestJson('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({
        title: `Reception: ${input.publication.displayName}`,
        workspace,
        mode: 'agent',
        approvalPolicy: 'always',
        sandboxMode: 'workspace-write'
      })
    })
    const threadId = requiredString(thread, 'id', 'Kun thread response')
    const turn = await this.requestJson(`/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: input.prompt,
        displayText: input.prompt,
        approvalPolicy: 'always',
        sandboxMode: 'workspace-write',
        disableUserInput: true,
        allowedToolNames
      })
    })
    return {
      status: 'running',
      ownerDeviceId: input.publication.ownerDeviceId,
      threadId,
      turnId: requiredString(turn, 'turnId', 'Kun turn response'),
      allowedToolNames
    }
  }

  async interrupt(input: { threadId: string; turnId: string }): Promise<void> {
    await this.requestJson(
      `/v1/threads/${encodeURIComponent(input.threadId)}/turns/${encodeURIComponent(input.turnId)}/interrupt`,
      { method: 'POST', body: '{}' }
    )
  }

  async inspect(input: { threadId: string; turnId: string }): Promise<ReceptionInvocationInspection> {
    const detail = await this.requestJson(`/v1/threads/${encodeURIComponent(input.threadId)}`, { method: 'GET' })
    const turns = Array.isArray(detail.turns) ? detail.turns : []
    const turn = turns.find((candidate): candidate is Record<string, unknown> => (
      Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).id === input.turnId
    ))
    if (!turn) throw new Error(`Kun turn not found: ${input.turnId}`)
    const status = typeof turn.status === 'string' ? turn.status : ''
    if (status === 'queued' || status === 'running') return { status: 'running' }
    if (status === 'completed') {
      const resultSummary = finalAssistantSummary(turn, input.turnId)
      return { status: 'completed', ...(resultSummary ? { resultSummary } : {}) }
    }
    const error = typeof turn.error === 'string' && turn.error.trim() ? turn.error.trim() : undefined
    if (status === 'aborted') return { status: 'interrupted', ...(error ? { error } : {}) }
    return { status: 'failed', ...(error ? { error } : {}) }
  }

  private async requestJson(path: string, init: { method?: string; body?: string }): Promise<Record<string, unknown>> {
    const response = await this.options.runtimeRequest(path, init)
    if (!response.ok) {
      throw new Error(`Kun request failed (${response.status}): ${summarizeBody(response.body)}`)
    }
    try {
      const value: unknown = JSON.parse(response.body)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // The error below keeps response details bounded and free of HTML noise.
    }
    throw new Error(`Kun returned an invalid JSON response: ${summarizeBody(response.body)}`)
  }
}

export function intersectToolNames(published: readonly string[], local: readonly string[]): string[] {
  const localSet = new Set(local)
  return [...new Set(published)].filter((name) => localSet.has(name))
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const result = value[key]
  if (typeof result !== 'string' || result.trim() === '') throw new Error(`${label} is missing ${key}`)
  return result
}

function summarizeBody(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  return compact.slice(0, 300) || 'empty response'
}

function finalAssistantSummary(turn: Record<string, unknown>, turnId: string): string {
  const items = Array.isArray(turn.items) ? turn.items : []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const item = candidate as Record<string, unknown>
    if (item.turnId !== undefined && item.turnId !== turnId) continue
    if (item.kind !== 'assistant_text' && item.kind !== 'agent_message') continue
    for (const field of ['text', 'detail', 'summary'] as const) {
      const value = item[field]
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 8_000)
    }
  }
  return ''
}
