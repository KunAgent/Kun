import type { TurnItem } from '../contracts/items.js'

export type ImDeliveryPhase = 'start' | 'progress' | 'final'
export type PrivateDeliveryGate = 'start' | 'progress' | 'none'
export type PrivateDeliveryState = {
  gate: PrivateDeliveryGate
  published: boolean
  waitingOnUser: boolean
  finalCurrent: boolean
  lastPhase?: ImDeliveryPhase
  lastVisibleAt?: string
  workSinceVisible: number
}
export type PrivateDeliveryReceipt = { lastVisibleAt?: string; lastDeliveryPhase?: ImDeliveryPhase }

/** Reconstruct from the current turn's durable items after restart or retry. */
export function privateDeliveryState(items: readonly TurnItem[], turnId: string, nowMs: number,
  communicationRequired: boolean, receipt?: PrivateDeliveryReceipt): PrivateDeliveryState {
  let published = false, waitingOnUser = false, lastPhase: ImDeliveryPhase | undefined
  let lastVisibleAt: string | undefined, workSinceVisible = 0, newestUserAt = 0
  const workTimes: number[] = []
  for (const item of items) {
    if (item.turnId !== turnId) continue
    if (item.kind === 'user_message') newestUserAt = Math.max(newestUserAt, Date.parse(item.createdAt) || 0)
    if (item.kind === 'user_input' || item.kind === 'approval') {
      published = true; waitingOnUser = item.status === 'pending'
      lastVisibleAt = item.createdAt; workSinceVisible = 0
      continue
    }
    if (item.kind !== 'tool_result') continue
    if (item.toolName === 'send_im_message' && item.isError !== true &&
      typeof item.output === 'object' && item.output !== null &&
      (item.output as { accepted?: unknown }).accepted === true) {
      const phase = (item.output as { phase?: unknown }).phase
      lastPhase = phase === 'start' || phase === 'progress' ? phase : 'final'
      published = true; waitingOnUser = false; lastVisibleAt = item.createdAt; workSinceVisible = 0
      continue
    }
    if (item.toolName === 'request_app_connection' && item.isError !== true &&
      typeof item.output === 'object' && item.output !== null &&
      (item.output as { requested?: unknown }).requested === true) {
      published = true; waitingOnUser = true; lastVisibleAt = item.createdAt; workSinceVisible = 0
      continue
    }
    if (PRIVATE_PUBLICATION_TOOL_NAMES.includes(item.toolName as typeof PRIVATE_PUBLICATION_TOOL_NAMES[number])) continue
    if (item.id.endsWith('_storm')) continue // The host recorded a denied call; no work ran.
    workSinceVisible++; workTimes.push(Date.parse(item.createdAt) || 0)
  }
  // A message and its run receipt commit together. The tool result may be
  // missing after a crash, so use the receipt instead of publishing twice.
  if (receipt?.lastDeliveryPhase && receipt.lastVisibleAt &&
    Date.parse(receipt.lastVisibleAt) > (lastVisibleAt ? Date.parse(lastVisibleAt) : 0)) {
    published = true; waitingOnUser = false
    lastPhase = receipt.lastDeliveryPhase; lastVisibleAt = receipt.lastVisibleAt
    workSinceVisible = workTimes.filter((time) => time > Date.parse(receipt.lastVisibleAt!)).length
  }
  const elapsedMs = lastVisibleAt ? nowMs - Date.parse(lastVisibleAt) : 0
  const newerUserMessage = published && newestUserAt > (lastVisibleAt ? Date.parse(lastVisibleAt) : 0)
  const progressDue = published && !waitingOnUser && workSinceVisible > 0 &&
    elapsedMs >= 10_000 && (elapsedMs >= 30_000 || workSinceVisible >= 6)
  return {
    gate: !communicationRequired || waitingOnUser ? 'none' : !published || newerUserMessage ? 'start' : progressDue ? 'progress' : 'none',
    published, waitingOnUser, finalCurrent: lastPhase === 'final' && workSinceVisible === 0 && !newerUserMessage,
    lastPhase, lastVisibleAt, workSinceVisible
  }
}

export const PRIVATE_PUBLICATION_TOOL_NAMES = [
  'send_im_message', 'user_input', 'request_user_input', 'request_app_connection'
] as const
