import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute } from 'node:path'
import { isPublicRuntimeEvent, type RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ThreadRecord,
  ThreadSummary
} from '../contracts/threads.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import { TurnConflictError, type TurnService } from './turn-service.js'
import type {
  ExtensionAgentProfileRegistry
} from './extension-agent-profile-registry.js'
import { DEFAULT_BUDGET, type ExtensionAgentEvent, type ExtensionAgentRunStatus, type ExtensionOwnedThread, type ExtensionPrincipal, MAXIMUM_BUDGET } from './extension-agent-service-contracts.js'
import { ExtensionBrokerError } from './extension-agent-service-event-usage.js'

export function projectThread(
  thread: ThreadRecord,
  latestRun?: ExtensionOwnedThread['latestRun']
): ExtensionOwnedThread {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    workspace: thread.workspace,
    model: thread.model,
    providerBinding: {
      providerId: thread.providerId ?? 'default',
      ...(thread.accountId ? { accountId: thread.accountId } : {}),
      modelId: thread.model
    },
    ownerExtensionVersion: thread.ownerExtensionVersion ?? 'unknown',
    ...(thread.extensionProfile?.id ? { profileId: thread.extensionProfile.id } : {}),
    visibility: thread.extensionVisibility ?? 'private',
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    runCount: thread.turns.length,
    ...(latestRun ? { latestRun } : {})
  }
}

export function projectEvent(
  principal: ExtensionPrincipal,
  runId: string,
  event: RuntimeEvent
): ExtensionAgentEvent | undefined {
  if (!isPublicRuntimeEvent(event)) return undefined
  const payload = publicEventPayload(event)
  if (!payload) return undefined
  return {
    seq: event.seq,
    timestamp: event.timestamp,
    type: event.kind,
    runId,
    threadId: event.threadId,
    ownerExtensionId: principal.extensionId,
    payload
  }
}

const MAX_PUBLIC_MESSAGE_CHARS = 256 * 1024

function publicEventPayload(event: RuntimeEvent): Record<string, unknown> | undefined {
  if (
    event.kind === 'item_created' ||
    event.kind === 'item_updated' ||
    event.kind === 'item_completed' ||
    event.kind === 'assistant_text_delta' ||
    event.kind === 'tool_call_started' ||
    event.kind === 'tool_call_finished'
  ) {
    return publicItemPayload(event.item, event.kind)
  }
  if (event.kind === 'turn_steered') {
    const content = boundedPublicText(event.displayText ?? event.text ?? '')
    if (!content) return undefined
    return {
      messageId: stablePublicId('steer', `${event.turnId ?? 'turn'}:${event.seq}`),
      role: 'user',
      phase: 'complete',
      content
    }
  }
  if (event.kind === 'usage') return { usage: event.usage }
  if (event.kind === 'turn_failed') {
    return { error: { code: boundedCode(event.code), message: 'Agent run failed' } }
  }
  if (
    event.kind === 'turn_started' || event.kind === 'turn_completed' ||
    event.kind === 'turn_aborted' || event.kind === 'approval_requested' ||
    event.kind === 'approval_resolved' || event.kind === 'user_input_requested' ||
    event.kind === 'user_input_resolved'
  ) return {}
  if (event.kind === 'required_tool_gate') {
    return {
      message: 'required_tool_gate',
      data: {
        toolName: boundedToolName(event.toolName), phase: event.phase,
        attempt: event.attempt, maxAttempts: event.maxAttempts
      }
    }
  }
  if (event.kind === 'model_request_retry') {
    return {
      message: 'model_request_retry',
      data: {
        attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs,
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.status ? { status: event.status } : {})
      }
    }
  }
  if (event.kind === 'tool_result_upload_wait') {
    return { message: 'tool_result_upload_wait', data: { status: event.status, toolResultCount: event.toolResultCount } }
  }
  if (event.kind === 'tool_call_ready') {
    return { message: 'tool_call_ready', data: { toolName: boundedToolName(event.toolName), readyCount: event.readyCount } }
  }
  if (event.kind === 'tool_storm_suppressed') {
    return { message: 'tool_storm_suppressed', data: { toolName: boundedToolName(event.toolName) } }
  }
  if (event.kind === 'source_tool_page') {
    return {
      message: 'source_tool_page',
      data: { toolName: boundedToolName(event.toolName), hasMore: event.hasMore }
    }
  }
  if (event.kind === 'compaction_started' || event.kind === 'compaction_completed') {
    return { message: event.kind }
  }
  if (event.kind === 'error') {
    return { message: 'runtime_error', data: { code: boundedCode(event.code) } }
  }
  return undefined
}

function publicItemPayload(
  item: TurnItem,
  eventKind: 'item_created' | 'item_updated' | 'item_completed' | 'assistant_text_delta' | 'tool_call_started' | 'tool_call_finished'
): Record<string, unknown> | undefined {
  if (item.kind === 'user_message') {
    return {
      messageId: stablePublicId('message', item.id),
      role: 'user',
      phase: item.status === 'completed' || eventKind === 'item_completed' ? 'complete' : 'replace',
      content: boundedPublicText(item.displayText ?? item.text)
    }
  }
  if (item.kind === 'assistant_text') {
    return {
      messageId: stablePublicId('message', item.id),
      role: 'assistant',
      phase: eventKind === 'assistant_text_delta'
        ? 'delta'
        : eventKind === 'item_completed'
          ? 'complete'
          : 'replace',
      content: boundedPublicText(item.text)
    }
  }
  if (item.kind === 'tool_call' || item.kind === 'tool_result') {
    const status = item.kind === 'tool_result'
      ? item.isError ? 'failed' : 'completed'
      : item.status === 'failed' || item.status === 'aborted'
        ? 'failed'
        : item.status === 'completed'
          ? 'completed'
          : 'running'
    const toolName = boundedToolName(item.toolName)
    return {
      messageId: stablePublicId('tool', item.callId),
      role: 'tool',
      phase: status === 'running' ? 'replace' : 'complete',
      content: {
        toolName,
        status,
        summary: `Tool ${toolName} ${status}`
      }
    }
  }
  return undefined
}

function boundedPublicText(value: string): string {
  if (value.length <= MAX_PUBLIC_MESSAGE_CHARS) return value
  return `${value.slice(0, MAX_PUBLIC_MESSAGE_CHARS - 1)}…`
}

function boundedToolName(value: string): string {
  return value.slice(0, 256) || 'tool'
}

function boundedCode(value: string | undefined): string {
  const code = value?.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128)
  return code || 'agent_run_failed'
}

function stablePublicId(prefix: string, raw: string): string {
  const direct = `${prefix}:${raw}`
  if (direct.length <= 256) return direct
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24)
  return `${prefix}:${raw.slice(0, 220 - prefix.length)}:${digest}`
}

export function runStatus(status: ThreadRecord['turns'][number]['status']): ExtensionAgentRunStatus {
  switch (status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'aborted': return 'cancelled'
    default: return 'running'
  }
}

export function validateBinding(binding: ExtensionProviderBinding): void {
  if (!binding.providerId.trim() || !binding.modelId.trim()) {
    throw new ExtensionBrokerError('validation_error', 'Provider binding requires providerId and modelId')
  }
  if (binding.accountId !== undefined && !binding.accountId.trim()) {
    throw new ExtensionBrokerError('validation_error', 'Provider binding accountId cannot be empty')
  }
}

export function normalizeOwnedWorkspace(principal: ExtensionPrincipal, requested?: string): string {
  const roots = principal.workspaceRoots.map((root) => resolve(root))
  if (roots.length === 0) throw new ExtensionBrokerError('workspace_denied', 'Extension has no workspace grant')
  const workspace = resolve(requested ?? roots[0]!)
  const owned = roots.some((root) => {
    const child = relative(root, workspace)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!owned) throw new ExtensionBrokerError('workspace_denied', 'Workspace is outside the extension grant')
  return workspace
}

export function completeBudget(
  partial: Partial<ExtensionRunBudget> | undefined,
  fallback: ExtensionRunBudget
): ExtensionRunBudget {
  return clampBudget({ ...fallback, ...partial }, MAXIMUM_BUDGET)
}

export function clampBudget(
  requested: Partial<ExtensionRunBudget>,
  maximum: ExtensionRunBudget
): ExtensionRunBudget {
  const out = {} as ExtensionRunBudget
  for (const key of Object.keys(DEFAULT_BUDGET) as Array<keyof ExtensionRunBudget>) {
    const value = requested[key] ?? DEFAULT_BUDGET[key]
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ExtensionBrokerError('validation_error', `Invalid extension run budget: ${key}`)
    }
    out[key] = Math.min(value, maximum[key])
  }
  return out
}

export function narrowToolScopes(profileScopes: readonly string[], requested: readonly string[] | undefined): string[] {
  const profile = [...new Set(profileScopes.map((value) => value.trim()).filter(Boolean))].sort()
  if (!requested) return profile
  const wanted = [...new Set(requested.map((value) => value.trim()).filter(Boolean))]
  if (profile.length === 0) return wanted.sort()
  const allowed = new Set(profile)
  for (const tool of wanted) {
    if (!allowed.has(tool)) {
      throw new ExtensionBrokerError('permission_denied', `Tool is outside the profile scope: ${tool}`)
    }
  }
  return wanted.sort()
}

export function titleFromInput(input: string): string {
  const line = input.split(/\r?\n/, 1)[0]?.trim() || 'Extension run'
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    if (Number.isSafeInteger(value.offset) && Number(value.offset) >= 0) return Number(value.offset)
  } catch {
    // Stable validation error below.
  }
  throw new ExtensionBrokerError('validation_error', 'Invalid thread cursor')
}

export function opaqueNotFound(): ExtensionBrokerError {
  return new ExtensionBrokerError('not_found', 'Extension-owned resource was not found')
}
