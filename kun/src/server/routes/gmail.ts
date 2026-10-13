import { z } from 'zod'
import { GmailScopeIdSchema, GmailModelRecipientIdSchema } from '../../contracts/gmail.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { GmailError, type GmailServicePort } from '../../gmail/ports.js'
import { roomAppConnectionMessage } from '../../rooms/room-app-connections.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { strictRuntimeTokenAuthorized } from './gateway-request-guard.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import { continueGmailTask, GmailContinueSchema } from './gmail-continuation.js'
import { TurnConflictError, TurnInProgressError, TurnCapacityError } from '../../services/turn-service.js'
import type { GmailModelSelection } from '../../gmail/model-data-policy.js'
import { GoogleWorkspaceModelPolicyError } from '../../domain/google-workspace-model-policy.js'
import { assertGmailRoomNotMirrored } from '../../gmail/room-data-boundary.js'

const BindingSchema = z.object({
  threadId: RoomIdSchema.optional(), roomId: RoomIdSchema.optional(), messageId: RoomIdSchema.optional()
}).strict().refine((value) => Boolean(value.threadId) !== Boolean(value.roomId && value.messageId) &&
  (!value.threadId || (!value.roomId && !value.messageId)) && Boolean(value.roomId) === Boolean(value.messageId),
  { message: 'Select the current thread or its private Agent connection card' })
const ConsentFields = { expectedRecipient: GmailModelRecipientIdSchema.optional(), expectedConsentId: z.string().min(1).max(256).optional() }
const AuthorizeSchema = BindingSchema.safeExtend({ allowModelSharing: z.boolean().default(false), ...ConsentFields })
const SharingSchema = BindingSchema.safeExtend({ allowModelSharing: z.boolean(), ...ConsentFields })
const DisconnectSchema = BindingSchema.safeExtend({ revoke: z.boolean().default(true) })
type Binding = z.infer<typeof BindingSchema>
const blocked = ['gmail', 'google_gmail', 'mcp:google_gmail', 'native:gmail']

class BodyError extends Error {
  constructor(readonly response: JsonResponse) { super('Invalid Gmail request') }
}
async function body(request: Request): Promise<unknown> {
  const result = await readJsonBody(request)
  if (!result.ok) throw new BodyError(result.response)
  return result.value
}

/** HTTP callers identify a persisted card/thread; they cannot supply a Gmail account or scope ID. */
export async function gmailRequestScope(runtime: ServerRuntime, binding: Binding): Promise<{
  scopeId: string; threadId: string; modelProviderName?: string; admittedSelection?: GmailModelSelection
}> {
  if (binding.threadId) {
    const thread = await runtime.threadService.get(binding.threadId)
    if (!thread || thread.status === 'archived' || thread.status === 'deleted' || thread.roomContext) {
      throw new GmailError('invalid_context', 'The current Kun thread is unavailable')
    }
    if (thread.turns.some((turn) => turn.imContext || turn.clientSurface === 'im')) {
      throw new GmailError('gmail_desktop_only', 'Use a separate desktop conversation for Gmail; this thread is linked to messaging')
    }
    const source = thread.turns.at(-1)
    return { scopeId: GmailScopeIdSchema.parse(`thread:${thread.id}`), threadId: thread.id,
      admittedSelection: source?.model ? { model: source.model, providerId: source.providerId } : undefined,
      modelProviderName: thread.providerId ?? thread.model }
  }
  const rooms = runtime.rooms
  if (!rooms) throw new GmailError('invalid_context', 'The private Agent conversation is unavailable')
  let room: Awaited<ReturnType<typeof rooms.service.get>>
  try { room = await rooms.service.get(binding.roomId!) }
  catch { throw new GmailError('invalid_context', 'The private Agent conversation is unavailable') }
  if (room.archivedAt || room.conversationKind !== 'user_agent') {
    throw new GmailError('invalid_context', 'Gmail requires an active private Agent conversation')
  }
  await assertGmailRoomNotMirrored(rooms.deps.store, room.id)
  let card: Awaited<ReturnType<typeof roomAppConnectionMessage>>
  try { card = await roomAppConnectionMessage(rooms.deps.store, binding.roomId!, binding.messageId!) }
  catch { throw new GmailError('invalid_context', 'The Gmail connection card is unavailable') }
  const member = room.members.find((item) => item.id === card.run.value.memberId)
  const thread = await runtime.threadService.get(card.run.value.threadId!)
  const scope = thread?.roomContext
  if (card.row.value.appConnection?.serverId !== 'google_gmail' ||
      card.row.value.appConnection.status === 'skipped' || !member?.enabled || member.removedAt ||
      !member.participantAgentId || member.participantAgentId !== card.run.value.participantAgentId ||
      !thread || thread.status === 'archived' || thread.status === 'deleted' ||
      !scope || scope.kind !== 'conversation' || scope.roomId !== room.id || scope.memberId !== member.id ||
      scope.participantAgentId !== member.participantAgentId || scope.blockedProviderIds.some((id) => blocked.includes(id))) {
    throw new GmailError('invalid_context', 'The Gmail card no longer belongs to an active Agent')
  }
  try { await rooms.deps.agentDirectory?.active(member.participantAgentId) }
  catch { throw new GmailError('invalid_context', 'The private Agent identity is no longer active') }
  const source = thread.turns.find((turn) => turn.id === card.run.value.turnId)
  if (!source?.model) throw new GmailError('invalid_context', 'The Gmail card’s admitted model route is unavailable')
  if (source.imContext || source.clientSurface === 'im') throw new GmailError('gmail_desktop_only', 'Open a dedicated desktop Gmail conversation')
  return { scopeId: GmailScopeIdSchema.parse(`room:${room.id}`), threadId: thread.id,
    admittedSelection: { model: source.model, providerId: source.providerId },
    modelProviderName: thread?.providerId ?? thread?.model }
}

export function registerGmailRoutes(router: Router, runtime: ServerRuntime): void {
  type Handler = (gmail: GmailServicePort, request: Request, context: RouteContext) => Promise<unknown>
  const add = (method: string, path: string, handle: Handler) => router.add(method, path, async (request, context) => {
    // A mailbox connection always requires the host token, including an otherwise insecure dev server.
    if (!strictRuntimeTokenAuthorized(request, runtime.runtimeToken)) return ERRORS.unauthorized()
    if (!runtime.gmail) return ERRORS.unavailable('Gmail is not available in this Kun runtime')
    try {
      if (method !== 'GET') await runtime.rooms?.deps.waitForOwnership?.(request.signal)
      const result = jsonResponse(await handle(runtime.gmail, request, context))
      result.headers['cache-control'] = 'no-store'
      return result
    } catch (error) {
      if (error instanceof BodyError) return error.response
      if (error instanceof z.ZodError) return ERRORS.validation('Invalid Gmail request', error.issues)
      if (error instanceof GmailError) return jsonResponse({ code: error.code, message: error.message },
        error.code === 'invalid_context' ? 404 : 409)
      if (error instanceof GoogleWorkspaceModelPolicyError) return jsonResponse({
        code: 'approved_model_required',
        message: 'This Gmail task keeps its original model route. Start a new task with the reviewed direct DeepSeek API account or Kun’s approved local Gmail model, then connect Gmail there.'
      }, 409)
      if (error instanceof TurnConflictError || error instanceof TurnInProgressError || error instanceof TurnCapacityError) {
        return ERRORS.conflict('Kun cannot continue this Gmail task while its execution state is changing')
      }
      return ERRORS.internal('Kun could not complete the Gmail connection request')
    }
  })
  const query = (request: Request) => BindingSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
  add('GET', '/v1/gmail/status', async (gmail, request) => {
    const bound = await gmailRequestScope(runtime, query(request))
    const access = runtime.gmailDataPolicy ? await runtime.gmailDataPolicy.availability(bound.threadId, bound.admittedSelection)
      : { allowed: false, reason: 'model_data_policy_unavailable', providerName: undefined,
        recipientBinding: undefined, recipient: undefined, endpoint: undefined, consentId: undefined }
    const status = await gmail.status(bound.scopeId, access.recipientBinding)
    return { ...status, allowModelSharing: Boolean(access.allowed && access.recipientBinding && status.allowModelSharing), modelProviderName: access.providerName ?? bound.modelProviderName,
      modelSharingAvailable: access.allowed, modelSharingReason: access.reason,
      modelProcessingRecipient: access.recipient, modelProcessingEndpoint: access.endpoint, modelProcessingConsentId: access.consentId }
  })
  add('POST', '/v1/gmail/authorize', async (gmail, request) => {
    const input = AuthorizeSchema.parse(await body(request))
    const bound = await gmailRequestScope(runtime, input)
    const recipient = input.allowModelSharing ? await assertModelConsent(runtime, bound, input) : undefined
    return gmail.startAuthorize({ scopeId: bound.scopeId, allowModelSharing: input.allowModelSharing, recipient })
  })
  for (const method of ['GET', 'DELETE'] as const) {
    add(method, '/v1/gmail/authorization/:id', async (gmail, request, context) => {
      const id = z.string().uuid().parse(context.params.id)
      const { scopeId } = await gmailRequestScope(runtime, query(request))
      return method === 'GET' ? gmail.pollAuthorization(id, scopeId) : gmail.cancelAuthorization(id, scopeId)
    })
  }
  add('PATCH', '/v1/gmail/sharing', async (gmail, request) => {
    const input = SharingSchema.parse(await body(request))
    const bound = await gmailRequestScope(runtime, input)
    const recipient = input.allowModelSharing ? await assertModelConsent(runtime, bound, input) : undefined
    return gmail.setModelSharing(bound.scopeId, input.allowModelSharing, recipient)
  })
  add('DELETE', '/v1/gmail/connection', async (gmail, request) => {
    const input = DisconnectSchema.parse(await body(request))
    const { scopeId } = await gmailRequestScope(runtime, input)
    await gmail.disconnect({ revoke: input.revoke })
    return gmail.status(scopeId)
  })
  add('POST', '/v1/gmail/continue', async (_gmail, request) =>
    continueGmailTask(runtime, GmailContinueSchema.parse(await body(request))))
  add('GET', '/v1/gmail/local-model', async (_gmail, request) => {
    await gmailRequestScope(runtime, query(request))
    return runtime.gmailLocalModel?.status() ?? { installed: false, running: false,
      ready: false, preparing: false, model: 'qwen3:4b', error: 'local_server_unavailable' }
  })
  add('POST', '/v1/gmail/local-model', async (_gmail, request) => {
    await gmailRequestScope(runtime, BindingSchema.parse(await body(request)))
    if (!runtime.gmailLocalModel) throw new GmailError('local_server_unavailable', 'Install Ollama before preparing Kun’s local Gmail model')
    return runtime.gmailLocalModel.prepare()
  })
}

export async function assertModelAccess(runtime: ServerRuntime,
  bound: { threadId: string; admittedSelection?: GmailModelSelection }): Promise<void> {
  if (!runtime.gmailDataPolicy) throw new GoogleWorkspaceModelPolicyError()
  await runtime.gmailDataPolicy.assertAllowed(bound.threadId, bound.admittedSelection)
}

async function assertModelConsent(runtime: ServerRuntime, bound: { threadId: string; admittedSelection?: GmailModelSelection },
  input: { expectedRecipient?: string; expectedConsentId?: string }) {
  await assertModelAccess(runtime, bound)
  const access = await runtime.gmailDataPolicy!.availability(bound.threadId, bound.admittedSelection)
  if (!access.allowed || !access.recipientBinding || !access.consentId ||
      input.expectedRecipient !== access.recipient || input.expectedConsentId !== access.consentId) {
    throw new GmailError('model_consent_changed', 'The model recipient or API account changed. Reload the Gmail card and review its data-sharing consent again.')
  }
  return access.recipientBinding
}
