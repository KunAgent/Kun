import { randomUUID } from 'node:crypto'
import type { ApprovalActionEnvelope } from '../contracts/approvals.js'
import type { ToolCallLike, ToolHostContext } from '../ports/tool-host.js'
import { ToolOperationJournal } from '../reliability/operation-journal.js'
import { consumeHostActionApprovalGrant } from '../adapters/tool/action-approval-grants.js'
import { googleWorkspaceCallArguments, validateGoogleWorkspaceCall, type ValidatedGoogleWorkspaceCall } from './catalog.js'

export type GoogleWorkspaceApprovalGrant = Readonly<{ id: string }>
const grants = new WeakMap<object, { hash: string; expiresAt: number }>()
const hash = (call: ValidatedGoogleWorkspaceCall): string => ToolOperationJournal.argsHash(googleWorkspaceCallArguments(call))

/** Called only at the tool execution boundary after the host's human approval. */
export function mintGoogleWorkspaceApproval(call: ValidatedGoogleWorkspaceCall, context: ToolHostContext): GoogleWorkspaceApprovalGrant | undefined {
  if (!call.requiresApproval) return undefined
  const proof = context.kunActionApprovalGrant
  if (!proof || proof.source !== 'user' || proof.toolName !== 'google_workspace_call' ||
    proof.callId !== context.activeToolCallId || proof.argumentsHash !== hash(call) ||
    Date.parse(proof.expiresAt) <= Date.now() || !consumeHostActionApprovalGrant(proof)) {
    throw new Error('Google Workspace write requires a matching one-use human approval from the active tool host')
  }
  const grant = Object.freeze({ id: randomUUID() })
  grants.set(grant, { hash: hash(call), expiresAt: Date.now() + 120_000 })
  return grant
}

/** Service must call immediately before executing each write. Never accept approved=true. */
export function consumeGoogleWorkspaceApproval(grant: GoogleWorkspaceApprovalGrant | undefined, call: ValidatedGoogleWorkspaceCall): void {
  if (!call.requiresApproval) return
  const approved = grant && grants.get(grant)
  if (grant) grants.delete(grant)
  if (!approved || approved.hash !== hash(call) || approved.expiresAt <= Date.now()) {
    throw new Error('Google Workspace mutation has no valid request-bound human approval')
  }
}

/** Full bounded payload: the generic envelope truncates body strings, which is unsafe for sending. */
export function buildGoogleWorkspaceApprovalAction(call: ToolCallLike, context: ToolHostContext): ApprovalActionEnvelope {
  const validated = validateGoogleWorkspaceCall(call.arguments as { method: unknown })
  const recipients = validated.body && 'text' in validated.body
    ? ['to', 'cc', 'bcc'].flatMap((key) => validated.body![key] as string[] ?? [])
    : Array.isArray(validated.body?.attendees)
      ? (validated.body.attendees as { email: string }[]).map((attendee) => attendee.email)
      : []
  return {
    version: 1, kind: 'external-effect', toolName: 'google_workspace_call', providerId: 'google-workspace',
    providerKind: 'built-in', toolKind: 'tool_call',
    effects: { network: true, externalWrite: true, processExecution: false, guiAutomation: false },
    arguments: validated.approvalPreview,
    workspace: context.workspace,
    targets: [
      { kind: 'resource', value: `${validated.method} ${JSON.stringify(validated.params)}` },
      ...[...new Set(recipients)].map((value) => ({ kind: 'recipient' as const, value }))
    ],
    reason: validated.risk === 'destructive'
      ? 'Destructive Google Workspace action requires your explicit confirmation'
      : 'Confirm the complete Google Workspace action, recipients and content shown below',
    requiresUserDecision: true, reviewerRequirement: 'user'
  }
}

export function buildGoogleWorkspaceApprovalSummary(action: ApprovalActionEnvelope): string {
  const preview = JSON.stringify(action.arguments, null, 2).replace(/[\u202a-\u202e\u2066-\u2069]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`)
  if (Buffer.byteLength(preview, 'utf8') > 96 * 1024) throw new Error('Google Workspace approval exceeds the complete preview limit')
  return `${action.reason}. Review every recipient and the complete content before allowing once.\n\n${preview}`
}
