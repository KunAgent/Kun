import type { ApprovalActionEnvelope } from '../contracts/approvals.js'
import type { HarnessPermissionMode } from '../contracts/harness.js'
import {
  createApprovalRequest,
  type ApprovalRequest,
  type ApprovalResolution
} from '../domain/approval.js'

/**
 * Host-owned context for a permission escalation. The manager runtime (P1)
 * supplies the durable approval channel; the envelope it receives is always
 * user-only, so no policy or reviewer can resolve it silently.
 */
export type EscalationApprovalContext = {
  threadId: string
  turnId: string
  nextId: (prefix: string) => string
  awaitApproval(
    approval: ApprovalRequest
  ): Promise<'allow' | 'deny' | ApprovalResolution>
}

export type EscalationRequest = {
  workerLabel: string
  harnessName: string
  /** The worker's isolated workspace — the only write root the grant covers. */
  workspacePath: string
  /** The harness permission mode the manager asked for above its own rank. */
  mode: HarnessPermissionMode
}

/**
 * Ask the user — and only the user — to widen a worker's permission past the
 * manager's authority (docs/ade/09 §7.2). The envelope is an external-effect
 * action pinned to `reviewerRequirement: 'user'`, so the auto policy, hooks,
 * and the agent reviewer all skip it. Abort, timeout, denial, or a broken
 * channel all resolve to false and produce no side effects.
 */
export async function requestUserOnlyEscalation(
  ctx: EscalationApprovalContext,
  input: EscalationRequest
): Promise<boolean> {
  const action: ApprovalActionEnvelope = {
    version: 1,
    kind: 'external-effect',
    toolName: 'ade.worker_permission_escalation',
    providerKind: 'delegation',
    effects: {
      network: true,
      externalWrite: true,
      processExecution: true,
      guiAutomation: false
    },
    arguments: {
      workerLabel: input.workerLabel,
      harnessName: input.harnessName,
      requestedPermissionMode: input.mode.id
    },
    workspace: input.workspacePath,
    targets: [{ kind: 'resource', value: input.workspacePath }],
    reason:
      `Allow worker "${input.workerLabel}" (${input.harnessName}) to run ` +
      `with ${input.mode.label} access, limited to workspace ${input.workspacePath}.`,
    requiresUserDecision: true,
    reviewerRequirement: 'user'
  }
  const request = createApprovalRequest({
    id: ctx.nextId('esc'),
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    toolName: action.toolName,
    summary:
      `Escalate worker "${input.workerLabel}" to ${input.mode.label} ` +
      `(workspace ${input.workspacePath})`,
    action
  })
  const decision = await ctx.awaitApproval(request).catch(() => 'deny' as const)
  const resolved = typeof decision === 'string' ? decision : decision.decision
  return resolved === 'allow'
}
