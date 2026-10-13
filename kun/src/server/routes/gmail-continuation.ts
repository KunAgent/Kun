import { createHash } from 'node:crypto'
import { z } from 'zod'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { GmailError, GMAIL_SCOPES } from '../../gmail/ports.js'
import type { ServerRuntime } from './server-runtime.js'
import { GoogleWorkspaceModelPolicyError } from '../../domain/google-workspace-model-policy.js'

export const GmailContinueSchema = z.object({
  threadId: RoomIdSchema, sourceTurnId: z.string().min(1).max(256), toolCallId: z.string().min(1).max(256)
}).strict()

/** A human clicks a persisted connection card; no model can initiate this continuation. */
export async function continueGmailTask(runtime: ServerRuntime, input: z.infer<typeof GmailContinueSchema>) {
  const thread = await runtime.threadService.get(input.threadId)
  if (!thread || thread.roomContext || thread.status === 'archived' || thread.status === 'deleted') {
    throw new GmailError('invalid_context', 'The original Gmail conversation is unavailable')
  }
  const source = thread.turns.find((turn) => turn.id === input.sourceTurnId)
  const result = source?.items.find((item) => item.kind === 'tool_result' && item.toolName === 'gmail_connect' &&
    item.callId === input.toolCallId && !item.isError)
  const marker = result?.kind === 'tool_result' ? (result.output as {
    gmailConnection?: { threadId?: unknown; sourceTurnId?: unknown; toolCallId?: unknown; scopeId?: unknown }
  })?.gmailConnection : undefined
  const scopeId = `thread:${thread.id}`
  if (!source || !marker || marker.threadId !== thread.id || marker.scopeId !== scopeId ||
      marker.sourceTurnId !== source.id || marker.toolCallId !== input.toolCallId) {
    throw new GmailError('invalid_context', 'The Gmail connection request was not issued by this task')
  }
  const clientRequestId = 'gmail-continue-' + createHash('sha256').update(JSON.stringify([
    thread.id, source.id, input.toolCallId
  ])).digest('hex')
  const existing = thread.turns.find((turn) => turn.clientRequestId === clientRequestId)
  if (!existing && (source.status !== 'completed' || thread.turns.at(-1)?.id !== source.id)) {
    throw new GmailError('task_changed', 'Wait for Kun to finish, or ask Kun to continue Gmail from the current conversation')
  }
  if (!runtime.gmail) throw new GmailError('connection_required', 'Connect Gmail in Kun')
  if (!runtime.gmailDataPolicy) throw new GoogleWorkspaceModelPolicyError()
  const access = await runtime.gmailDataPolicy.availability(thread.id, source.model ? { model: source.model, providerId: source.providerId } : undefined)
  if (!access.allowed || !access.recipientBinding) throw new GoogleWorkspaceModelPolicyError()
  const status = await runtime.gmail.status(scopeId, access.recipientBinding)
  if (!status.connected || !status.allowModelSharing || !GMAIL_SCOPES.every((scope) => status.scopes.includes(scope))) {
    throw new GmailError('sharing_consent_required', 'Connect Gmail and allow this conversation’s model to use mail first')
  }
  if (!runtime.gmailDataPolicy) throw new GoogleWorkspaceModelPolicyError()
  await runtime.gmailDataPolicy.assertAllowed(thread.id,
    source.model ? { model: source.model, providerId: source.providerId } : undefined)
  return runtime.turnService.startTurn({ threadId: thread.id, request: {
    clientRequestId,
    prompt: 'The user connected Gmail through Kun and allowed email data to be shared with this conversation’s selected model. Continue the original task using the Gmail tools. Do not repeat completed external actions. Sending email still requires a separate human approval of the exact message.',
    displayText: 'Continue the Gmail task', clientSurface: source.clientSurface,
    model: source.model, providerId: source.providerId, harnessId: source.harnessId,
    credentialMode: source.credentialMode, accountId: source.accountId,
    harnessAgentId: source.harnessAgentId, harnessSettings: source.harnessSettings,
    gatewayBinding: source.gatewayBinding,
    reasoningEffort: source.reasoningEffort, serviceTier: source.serviceTier,
    mode: source.mode, approvalPolicy: source.approvalPolicy, sandboxMode: source.sandboxMode,
    approvalReviewer: source.approvalReviewer
  } }, { onAdmitted: ({ threadId, turnId }) => { void runtime.runTurn(threadId, turnId) } })
}
