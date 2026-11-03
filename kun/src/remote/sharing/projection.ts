import { canonical } from '@kun/remote-protocol'
import type { Turn } from '../../contracts/turns.js'
import type { ShareActor } from './contracts.js'
import { shareDigest } from './journal.js'
export const sharedTurnPrefix = (actor: ShareActor) => 'shared_' + shareDigest([actor.ownerAccountId, actor.hostDeviceId,
  actor.shareId, actor.memberId, actor.guestAccountId]).slice(0, 24) + '_'
export const sharedTurnKey = (actor: ShareActor, requestId: string) => sharedTurnPrefix(actor) + shareDigest([actor.deviceId, requestId]).slice(0, 48)
export const ownsSharedTurn = (actor: ShareActor, turn: Pick<Turn, 'clientRequestId'>) => Boolean(turn.clientRequestId?.startsWith(sharedTurnPrefix(actor)))
export const visibleSharedTurn = (actor: ShareActor, turn: Turn) => turn.status !== 'queued' || ownsSharedTurn(actor, turn)
export const SHARED_ITEM_KINDS = new Set(['user_message', 'assistant_text', 'assistant_reasoning', 'tool_call', 'tool_result', 'error'])
const cut = (text: string) => text.length > 16000 ? text.slice(0, 16000) + '\n[Content continues in message preview]' : text
/** Public conversation content only: no provider signatures, model routes, workspace/config snapshots or executable consent. */
export function projectSharedItem(raw: any, allowedReferenceId?: string) {
  if (!raw || !SHARED_ITEM_KINDS.has(raw.kind)) return null
  const output: Record<string, unknown> = {}
  for (const key of ['id', 'turnId', 'threadId', 'kind', 'role', 'status', 'createdAt', 'finishedAt', 'toolName', 'callId', 'toolKind', 'isError', 'renderMode'])
    if (raw[key] !== undefined) output[key] = raw[key]
  for (const key of ['text', 'displayText', 'summary', 'detail', 'message']) if (typeof raw[key] === 'string') output[key] = cut(raw[key])
  for (const key of ['arguments', 'output']) if (raw[key] !== undefined) {
    const encoded = canonical(raw[key])
    output[key] = encoded.length <= 16000 ? raw[key] : key === 'arguments' ? { summary: cut(encoded) } : cut(encoded)
  }
  const order = raw.sourceHistoryOrder
  if (allowedReferenceId && order?.referenceId === allowedReferenceId && Number.isSafeInteger(order.turnIndex) && order.turnIndex >= 0 &&
      Number.isSafeInteger(order.itemIndex) && order.itemIndex >= 0) output.sourceHistoryOrder = { referenceId: allowedReferenceId, turnIndex: order.turnIndex, itemIndex: order.itemIndex }
  if (Array.isArray(raw.attachmentIds)) output.attachmentIds = raw.attachmentIds.filter((id: unknown) => typeof id === 'string' && /^att_[a-f0-9]{24}$/.test(id)).slice(0, 8)
  if (typeof raw.text === 'string' && raw.text.length > 16000) output.contentTruncated = true
  return output
}
export function projectSharedTurn(raw: any, actor: ShareActor, allowedReferenceId?: string) {
  if (!raw || !visibleSharedTurn(actor, raw)) return null
  const turn: Record<string, unknown> = {}
  for (const key of ['id', 'status', 'createdAt', 'startedAt', 'finishedAt', 'clientSurface']) if (raw[key] !== undefined) turn[key] = raw[key]
  if (Array.isArray(raw.items)) turn.items = raw.items.map((item: any) => projectSharedItem(item, allowedReferenceId)).filter(Boolean)
  return turn
}
export function projectSharedHistory(raw: any, actor: ShareActor, turns: Turn[], historyVersion?: string, referenceId?: string) {
  const native = new Set(turns.map((turn) => turn.id)), external = new Set<string>()
  const visible = new Set(turns.filter((turn) => visibleSharedTurn(actor, turn)).map((turn) => turn.id))
  if (referenceId && raw.sourceHistory?.referenceId === referenceId && raw.sourceHistory.readOnly === true && raw.sourceHistory.status === 'available')
    for (const turn of raw.turns ?? []) if (turn.status !== 'queued' && !native.has(turn.id)) { visible.add(turn.id); external.add(turn.id) }
  const result: Record<string, unknown> = {}
  for (const key of ['historyRefId', 'eventScope']) if (typeof raw[key] === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(raw[key])) result[key] = raw[key]
  if (typeof raw.sourceHistory?.status === 'string') result.sourceHistory = { status: raw.sourceHistory.status }
  for (const key of ['id', 'title', 'status', 'createdAt', 'updatedAt', 'latestSeq', 'timeline']) if (raw[key] !== undefined) result[key] = raw[key]
  result.turns = (raw.turns ?? []).filter((turn: any) => visible.has(turn.id) && ((turn.items?.length ?? 0) > 0 || turn.id === raw.activeTurn?.id || turn.id === raw.latestTurn?.id)).map((turn: any) => projectSharedTurn(turn, actor, external.has(turn.id) ? referenceId : undefined)).filter(Boolean)
  result.items = (raw.items ?? []).filter((item: any) => visible.has(item.turnId)).map((item: any) => projectSharedItem(item, external.has(item.turnId) ? referenceId : undefined)).filter(Boolean)
  result.activeTurn = visible.has(raw.activeTurn?.id) ? projectSharedTurn(raw.activeTurn, actor) : null
  result.latestTurn = visible.has(raw.latestTurn?.id) ? projectSharedTurn(raw.latestTurn, actor) : null
  result.historyVersion = historyVersion
  result.pendingApprovalIds = []; result.pendingUserInputIds = []; result.artifacts = []
  return result
}
