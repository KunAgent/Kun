/**
 * ACP `session/request_permission` handling (docs/ade/03 §8.3).
 * The agent's tool call is translated into a Kun approval envelope and put
 * through the normal approval pipeline (policy → agent reviewer → user
 * gate). Kun approvals have once-only semantics, so an `allow` maps to
 * `allow_once` — `allow_always` is only ever selected when it is the
 * sole option the agent offered.
 */
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest
} from '../../domain/approval.js'
import type { ApprovalActionEnvelope } from '../../contracts/approvals.js'
import type { AcpRequestPermissionParams } from './acp-schema.js'

export type AcpPermissionOption = {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
  name?: string | null
}

/** What the runtime injects: build + gate + decide, same as tool calls. */
export type AcpApproveFn = (
  approval: ApprovalRequest
) => Promise<'allow' | 'deny'>

/**
 * Once-approved (kind, target) pairs for the current turn. When an agent
 * gets `request_permission` allowed and then issues the mediated write/exec
 * call, the file/terminal handler skips a second prompt for the same target.
 */
export class AcpApprovalMemo {
  private readonly allowed = new Map<string, Set<string>>()

  private key(turnId: string): Set<string> {
    let set = this.allowed.get(turnId)
    if (!set) {
      set = new Set()
      this.allowed.set(turnId, set)
    }
    return set
  }

  mark(turnId: string, kind: 'file' | 'command', target: string): void {
    this.key(turnId).add(`${kind}:${target}`)
  }

  has(turnId: string, kind: 'file' | 'command', target: string): boolean {
    return this.key(turnId).has(`${kind}:${target}`)
  }

  clear(turnId: string): void {
    this.allowed.delete(turnId)
  }
}

export type AcpPendingSlot = {
  /** Resolves when `cancelAll` fires — race this against the approval. */
  cancelled: Promise<void>
  /** Resolves the cancelled promise (used by cancelAll). */
  cancel: () => void
  /** Detach the slot once the handler answered — idempotent. */
  done: () => void
}

/**
 * In-flight `request_permission` calls keyed by sessionId. `cancelAll`
 * resolves every waiter so the handler can answer `outcome: 'cancelled'`
 * before the agent's `session/cancel` unwinds the turn.
 */
export class AcpPendingPermissions {
  private readonly slots = new Map<string, Set<AcpPendingSlot>>()

  track(sessionId: string): AcpPendingSlot {
    let cancel!: () => void
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve
    })
    let set = this.slots.get(sessionId)
    if (!set) {
      set = new Set()
      this.slots.set(sessionId, set)
    }
    const slot: AcpPendingSlot = {
      cancelled,
      cancel,
      done: () => {
        set.delete(slot)
        if (set.size === 0) this.slots.delete(sessionId)
      }
    }
    set.add(slot)
    return slot
  }

  /** Resolve every pending permission for the session as cancelled. */
  cancelAll(sessionId: string): void {
    const set = this.slots.get(sessionId)
    if (!set) return
    this.slots.delete(sessionId)
    for (const slot of set) slot.cancel()
  }
}

/** §8.3 kind mapping for the approval envelope. */
export function acpPermissionActionKind(
  kind: string | null | undefined
): { actionKind: 'command' | 'file' | 'network' | 'external-effect' | 'unknown'
    toolKind: 'command_execution' | 'file_change' | 'tool_call' } {
  switch (kind) {
    case 'execute':
      return { actionKind: 'command', toolKind: 'command_execution' }
    case 'edit':
    case 'delete':
    case 'move':
    case 'read':
      return { actionKind: 'file', toolKind: 'file_change' }
    case 'fetch':
      return { actionKind: 'network', toolKind: 'tool_call' }
    default:
      return { actionKind: 'unknown', toolKind: 'tool_call' }
  }
}

/** Build the approval request (envelope + request shell) for a tool call. */
export function approvalRequestFromAcp(input: {
  params: AcpRequestPermissionParams
  threadId: string
  turnId: string
  workspace: string
  approvalId: string
}, toolNameOverride?: string): ApprovalRequest {
  const toolCall = input.params.toolCall
  const kind = toolCall.kind ?? 'other'
  const { actionKind, toolKind } = acpPermissionActionKind(kind)
  const toolName = toolNameOverride ?? `acp:${kind}`
  const locations = (toolCall.locations ?? []).filter(
    (location): location is { path: string; line?: number | null } =>
      typeof location?.path === 'string' && location.path.length > 0
  )
  const action: ApprovalActionEnvelope = createApprovalActionEnvelope({
    toolName,
    providerKind: 'delegation',
    toolKind,
    effects: {
      network: actionKind === 'network',
      externalWrite: actionKind === 'file' && kind !== 'read',
      processExecution: actionKind === 'command',
      guiAutomation: false
    },
    arguments: {
      ...(toolCall.title ? { title: toolCall.title } : {}),
      kind,
      ...(locations.length
        ? { locations: locations.map((l) => ({ path: l.path, ...(l.line ? { line: l.line } : {}) })) }
        : {}),
      ...(toolCall.rawInput !== undefined
        ? { rawInput: truncateForApproval(toolCall.rawInput) }
        : {})
    },
    workspace: input.workspace,
    reason: toolCall.title ?? `ACP agent requested permission for ${toolName}`
  })
  return createApprovalRequest({
    id: input.approvalId,
    threadId: input.threadId,
    turnId: input.turnId,
    toolName,
    summary: safeApprovalActionSummary(action),
    action
  })
}

/**
 * Pick the response option for a Kun decision. `allow` prefers
 * `allow_once`; `allow_always` is only selected when no once-option exists
 * (never widening permission beyond this call — §8.3).
 */
export function pickPermissionOutcome(
  options: readonly AcpPermissionOption[],
  decision: 'allow' | 'deny' | 'cancelled'
): { outcome: { outcome: 'selected'; optionId: string } } | { outcome: { outcome: 'cancelled' } } {
  if (decision === 'cancelled') return { outcome: { outcome: 'cancelled' } }
  const wanted =
    decision === 'allow'
      ? (options.find((o) => o.kind === 'allow_once') ??
        options.find((o) => o.kind === 'allow_always'))
      : (options.find((o) => o.kind === 'reject_once') ??
        options.find((o) => o.kind === 'reject_always'))
  return wanted
    ? { outcome: { outcome: 'selected', optionId: wanted.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

/**
 * Paths/commands the agent may reuse after an allow — memo keys for dedup.
 * File targets are resolved through `resolvePath` (physical, inside the
 * write roots); locations that fail to resolve are skipped so a bad path in
 * the display metadata can never fail the permission response itself.
 */
export async function acpPermissionTargets(
  params: AcpRequestPermissionParams,
  resolvePath: (path: string) => Promise<string>
): Promise<Array<{ kind: 'file' | 'command'; target: string }>> {
  const toolCall = params.toolCall
  const kind = toolCall.kind ?? 'other'
  const targets: Array<{ kind: 'file' | 'command'; target: string }> = []
  if (kind === 'execute') {
    const raw = toolCall.rawInput
    const command =
      raw && typeof raw === 'object' && typeof (raw as { command?: unknown }).command === 'string'
        ? (raw as { command: string }).command
        : toolCall.title ?? ''
    if (command) targets.push({ kind: 'command', target: command })
    const args =
      raw && typeof raw === 'object' && Array.isArray((raw as { args?: unknown }).args)
        ? (raw as { args: unknown[] }).args.filter((a): a is string => typeof a === 'string')
        : []
    if (command && args.length) {
      targets.push({ kind: 'command', target: [command, ...args].join(' ') })
    }
  }
  for (const location of toolCall.locations ?? []) {
    if (typeof location?.path === 'string' && location.path) {
      try {
        targets.push({ kind: 'file', target: await resolvePath(location.path) })
      } catch {
        // unresolvable location — the mediated call will enforce the boundary
      }
    }
  }
  return targets
}

function truncateForApproval(raw: unknown): unknown {
  try {
    const serialized = JSON.stringify(raw)
    if (serialized.length <= 16 * 1024) return raw
    return {
      _truncated: true,
      bytes: serialized.length,
      preview: serialized.slice(0, 16 * 1024)
    }
  } catch {
    return '[unserializable]'
  }
}
