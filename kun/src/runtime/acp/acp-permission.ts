/**
 * ACP `session/request_permission` handling.
 * The agent's tool call is translated into a Kun approval envelope and put
 * through the normal approval pipeline (policy → agent reviewer → user
 * gate). Unqualified approval authorizes one call only. Standing permission
 * options require the human to choose that exact option explicitly.
 */
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest,
  type ApprovalResolution
} from '../../domain/approval.js'
import { approvalChoiceIsValid } from '../../contracts/approval-choice.js'
import { validAcpPermissionMenu } from './acp-permission-options.js'
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
) => Promise<'allow' | 'deny' | ApprovalResolution>

export function acpDecision(resolution: 'allow' | 'deny' | ApprovalResolution): 'allow' | 'deny' {
  return typeof resolution === 'string' ? resolution : resolution.decision
}

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

/** kind mapping for the approval envelope. */
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

/**
 * Execution detail the ACP agent actually declared for a tool call. The title
 * is presentation text and must never be treated as the authorized command.
 */
export function acpExecutionDetail(toolCall: {
  kind?: string | null
  rawInput?: unknown
}): { command?: string; cwd?: string } {
  const raw = toolCall.rawInput
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as { command?: unknown; args?: unknown; cwd?: unknown }
  const argv = typeof record.command === 'string'
    ? [record.command]
    : Array.isArray(record.command)
      ? record.command.filter((part): part is string => typeof part === 'string')
      : []
  const args = Array.isArray(record.args)
    ? record.args.filter((part): part is string => typeof part === 'string')
    : []
  const command = argv.length ? [argv[0], ...args].join(' ') : ''
  const cwd = typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd.trim() : undefined
  return {
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {})
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
  const execution = acpExecutionDetail(toolCall)
  let action: ApprovalActionEnvelope = createApprovalActionEnvelope({
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
      ...(execution.command ? { command: execution.command } : {}),
      ...(execution.cwd ? { cwd: execution.cwd } : {}),
      ...(locations.length
        ? { locations: locations.map((l) => ({ path: l.path, ...(l.line ? { line: l.line } : {}) })) }
        : {}),
      ...(toolCall.rawInput !== undefined
        ? { rawInput: truncateForApproval(toolCall.rawInput) }
        : {}),
      ...(toolCall.content?.some((item) => item.type === 'diff') ? {
        changes: toolCall.content.filter((item) => item.type === 'diff')
      } : {})
    },
    workspace: input.workspace,
    reason: toolCall.title ?? `ACP agent requested permission for ${toolName}`
  })
  if (input.params.options.length) {
    action = Object.freeze({ ...action, permissionOptions: input.params.options.map(({ optionId, kind, name }) => ({ optionId, kind, name })) })
  }
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
 * Preserve an explicit human choice. Unqualified decisions never grant a
 * standing permission, even when the agent offers no once-only alternative.
 */
export function pickPermissionOutcome(
  options: readonly AcpPermissionOption[],
  resolution: 'allow' | 'deny' | 'cancelled' | ApprovalResolution
): { outcome: { outcome: 'selected'; optionId: string } } | { outcome: { outcome: 'cancelled' } } {
  // Validate the entire menu before every selection path, including automatic
  // once-only approval. An ID shared with an always/deny option is ambiguous.
  if (!validAcpPermissionMenu(options)) {
    return { outcome: { outcome: 'cancelled' } }
  }
  if (resolution === 'cancelled') return { outcome: { outcome: 'cancelled' } }
  const decision = acpDecision(resolution)
  const choice = typeof resolution === 'object' ? resolution.choice : undefined
  if (choice) {
    const valid = approvalChoiceIsValid(options.map((option) => ({ ...option, name: option.name ?? '' })), decision, choice)
    if (!valid || 'cancelled' in choice || typeof resolution !== 'object' || resolution.reviewer !== 'user') return { outcome: { outcome: 'cancelled' } }
    return { outcome: { outcome: 'selected', optionId: choice.optionId } }
  }
  const wanted =
    decision === 'allow'
      ? options.find((o) => o.kind === 'allow_once')
      : options.find((o) => o.kind === 'reject_once')
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
    const command = acpExecutionDetail(toolCall).command
    if (command) targets.push({ kind: 'command', target: command })
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
