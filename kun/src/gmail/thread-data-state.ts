import type { TurnItem } from '../contracts/items.js'
import { GmailScopeIdSchema, type GmailModelRecipientBinding } from '../contracts/gmail.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'
import type { GmailServicePort } from './ports.js'
import type { GmailModelDataPolicyOptions, GmailModelSelection, GmailThreadDataState } from './model-data-policy.js'
import { roomPeerStoreBinding } from '../rooms/room-peer-store-binding.js'
import { hasActiveImMirror } from './room-data-boundary.js'

const MAX_LINEAGE = 128
const MAX_HISTORY_REFERENCES = 128
const GOOGLE_MAIL_TOOLS = new Set(['gmail_read', 'gmail_search', 'gmail_send'])
const HISTORY_TOOLS = new Set(['read_thread_history', 'read_source_history', 'read_agent_history'])
type GmailState = Pick<GmailServicePort, 'hasGoogleData' | 'markGoogleData' | 'status' | 'captureModelSharingFence'>
type ThreadLookup = Pick<ThreadStore, 'get' | 'getMetadata'>
const bindings = new WeakMap<ThreadStore, GmailState>()

export function bindGmailThreadDataProtection(threads: ThreadStore, gmail: GmailState): void {
  bindings.set(threads, gmail)
}

/** Resolve taint from canonical identities, including deleted-but-still-classified ancestors. */
export async function resolveGmailThreadDataState(
  threads: ThreadLookup, gmail: GmailState, threadId: string, history: readonly TurnItem[] = [], sourceIds: readonly string[] = [], recipient?: GmailModelRecipientBinding
): Promise<GmailThreadDataState> {
  const queue = [threadId, ...sourceIds]
  const scopes = new Set<string>()
  const recipientScopes = new Set<string>()
  const visited = new Set<string>()
  let primaryRecipient: string | undefined
  let unboundMailEvidence = false
  let messagingOrigin = false
  for (const item of history) {
    if (item.kind === 'tool_result' && !item.isError && GOOGLE_MAIL_TOOLS.has(item.toolName)) unboundMailEvidence = true
    if (item.threadId && item.threadId !== threadId) queue.push(item.threadId)
    if (item.kind === 'tool_result' && !item.isError && HISTORY_TOOLS.has(item.toolName)) {
      const evidence = historyEvidence(item.output)
      unboundMailEvidence ||= evidence.googleMail
      queue.push(...evidence.sourceThreads)
    }
  }
  if (new Set(queue).size > MAX_HISTORY_REFERENCES) throw new GoogleWorkspaceModelPolicyError('Google data history has too many source identities to verify safely.')
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    if (visited.size >= MAX_LINEAGE) throw new GoogleWorkspaceModelPolicyError('Google data history lineage could not be fully verified.')
    visited.add(id)
    const scope = GmailScopeIdSchema.safeParse(`thread:${id}`)
    if (scope.success) {
      scopes.add(scope.data)
      if (id === threadId) recipientScopes.add(scope.data)
      if (id === threadId) primaryRecipient = scope.data
    }
    const thread = await (threads.getMetadata?.(id) ?? threads.get(id))
    if (!thread) continue
    if (id === threadId && thread.turns.some((turn) => turn.imContext || turn.clientSurface === 'im')) messagingOrigin = true
    for (const roomId of [thread.roomContext?.roomId, thread.workbenchOrigin?.roomId]) {
      if (!roomId) continue
      const roomScope = GmailScopeIdSchema.safeParse(`room:${roomId}`)
      if (!roomScope.success) throw new GoogleWorkspaceModelPolicyError('The Google data conversation scope is invalid.')
      scopes.add(roomScope.data)
      if (id === threadId && thread.roomContext?.kind === 'conversation' && thread.roomContext.roomId === roomId) {
        recipientScopes.add(roomScope.data)
        primaryRecipient = roomScope.data
      }
    }
    for (const parent of [thread.parentThreadId, thread.forkedFromThreadId]) if (parent) queue.push(parent)
  }
  const sensitiveScopes: string[] = []
  for (const scope of scopes) {
    if (!await gmail.hasGoogleData(scope)) continue
    sensitiveScopes.push(scope)
  }
  const sensitive = sensitiveScopes.length > 0 || unboundMailEvidence
  let sharingAllowed = sensitive
  const sharingFences: (() => void)[] = []
  const consent = async (scope: string) => {
    // Capture before the async read: a revocation may arrive after its stale snapshot resolves.
    const fence = recipient ? gmail.captureModelSharingFence(scope) : undefined
    const allowed = (await gmail.status(scope)).allowModelSharing
    if (allowed && fence) { fence(); sharingFences.push(fence) }
    return allowed
  }
  if (sensitive) {
    // Propagate classification, never consent, before any outbound model call.
    // A later deletion of the source conversation cannot remove this fence.
    if (!primaryRecipient) throw new GoogleWorkspaceModelPolicyError('The receiving Google data conversation could not be verified.')
    if (!sensitiveScopes.includes(primaryRecipient)) await gmail.markGoogleData(primaryRecipient)
    let recipientAllowed = false
    for (const scope of recipientScopes) if (await consent(scope)) recipientAllowed = true
    sharingAllowed &&= recipientAllowed
    for (const scope of sensitiveScopes) {
      if (!recipientScopes.has(scope) && !await consent(scope)) sharingAllowed = false
    }
    if (messagingOrigin) sharingAllowed = false
    const roomScopes = sensitiveScopes.filter((scope) => scope.startsWith('room:'))
    if (roomScopes.length) {
      const roomStore = roomPeerStoreBinding(threads as ThreadStore)
      if (!roomStore) sharingAllowed = false
      else for (const scope of roomScopes) if (await hasActiveImMirror(roomStore, scope.slice(5))) sharingAllowed = false
    }
  }
  return { sensitive, sharingAllowed: sensitive && sharingAllowed,
    ...(recipient && sensitive && sharingAllowed ? { assertSharingCurrent: () => {
      for (const fence of sharingFences) fence()
    } } : {}) }
}

function historyEvidence(output: unknown): { googleMail: boolean; sourceThreads: string[] } {
  const queue = [output]
  const seen = new Set<object>()
  const sourceThreads = new Set<string>()
  let googleMail = false
  while (queue.length) {
    const value = queue.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    if (seen.size >= 4_096) throw new GoogleWorkspaceModelPolicyError('The source history is too large to verify Google data safely.')
    seen.add(value)
    if (Array.isArray(value)) { queue.push(...value); continue }
    const item = value as Record<string, unknown>
    if (item.googleWorkspaceData === true) googleMail = true
    if (item.kind === 'tool_result' && item.isError !== true && typeof item.toolName === 'string' && GOOGLE_MAIL_TOOLS.has(item.toolName)) {
      googleMail = true
    }
    if (typeof item.kind === 'string' && typeof item.threadId === 'string' &&
        GmailScopeIdSchema.safeParse(`thread:${item.threadId}`).success) sourceThreads.add(item.threadId)
    queue.push(...Object.values(item))
  }
  return { googleMail, sourceThreads: [...sourceThreads] }
}

export function createGmailThreadDataPolicyOptions(
  threads: ThreadStore, gmail: GmailState,
  fallback: () => GmailModelSelection
): GmailModelDataPolicyOptions {
  bindGmailThreadDataProtection(threads, gmail)
  return {
    selection: async (threadId) => {
      const thread = await (threads.getMetadata?.(threadId) ?? threads.get(threadId))
      const source = thread?.turns.filter((turn) => turn.status !== 'queued' && !turn.admissionPending).at(-1)
      if (source?.model) return { model: source.model, providerId: source.providerId }
      return thread ? { model: thread.model, providerId: thread.providerId } : fallback()
    },
    dataState: (threadId, history, recipient) => resolveGmailThreadDataState(threads, gmail, threadId, history, [], recipient)
  }
}

/** Classify before any copied history or metadata is written. No new access is granted. */
export async function inheritGoogleDataBeforeThreadWrite(
  threads: ThreadStore, recipient: ThreadRecord, history: readonly TurnItem[] = [], sourceIds: readonly string[] = []
): Promise<void> {
  const gmail = bindings.get(threads)
  if (!gmail) return
  const lookup: ThreadLookup = {
    get: async (id) => id === recipient.id ? recipient : threads.get(id),
    getMetadata: async (id) => id === recipient.id ? recipient : await (threads.getMetadata?.(id) ?? threads.get(id))
  }
  await resolveGmailThreadDataState(lookup, gmail, recipient.id, history, sourceIds)
}

export async function classifyBorrowedGoogleHistory(threads: ThreadStore, threadId: string, output: unknown): Promise<void> {
  const gmail = bindings.get(threads)
  if (!gmail) return
  const evidence = historyEvidence(output)
  if (evidence.googleMail) await gmail.markGoogleData(GmailScopeIdSchema.parse(`thread:${threadId}`))
  if (evidence.sourceThreads.length) await resolveGmailThreadDataState(threads, gmail, threadId, [], evidence.sourceThreads)
}

export function assertNoGoogleHistorySdkExport(output: unknown): void {
  if (historyEvidence(output).googleMail) throw new GoogleWorkspaceModelPolicyError('Google mail history cannot be exported to an external Agent or subscription SDK.')
}

export async function isBoundGmailSensitiveHistory(threads: ThreadStore, threadId: string,
  history: readonly TurnItem[] = []): Promise<boolean> {
  const gmail = bindings.get(threads)
  return gmail ? (await resolveGmailThreadDataState(threads, gmail, threadId, history)).sensitive : false
}

export async function isBoundGmailSensitiveRoom(threads: ThreadStore, roomId: string): Promise<boolean> {
  const gmail = bindings.get(threads)
  return gmail ? gmail.hasGoogleData(GmailScopeIdSchema.parse(`room:${roomId}`)) : false
}
