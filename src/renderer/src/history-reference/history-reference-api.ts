import { rendererRuntimeClient } from '../agent/runtime-client'
import type { CoreThreadSummaryJson } from '../agent/kun-contract'
import type { CoreTurnJson } from '../agent/kun-contract-runtime'
import { chatBlockFromItem, mergeChatBlocks } from '../agent/kun-mapper'
import type { ChatBlock } from '../agent/types'

export type HistorySession = {
  sessionId: string; path: string; title: string; workspace: string; updatedAt: string; archived: boolean
}
export type HistoryReference = {
  id: string; sessionId: string; title: string; workspace: string; cutoffTurnId: string
  files: Array<{ path: string }>; warnings: string[]
}
export type HistoryPage = {
  turns: CoreTurnJson[]; nextCursor?: string; hasMore: boolean
  status: 'available' | 'missing' | 'changed' | 'partial'; warnings: string[]
  content?: { itemId: string; field: 'text' | 'arguments' | 'output'; text: string; offset: number; nextOffset?: number; totalChars: number }
}
export type HistoryPreview = {
  session: HistorySession
  cutoffs: Array<{ turnId: string; createdAt: string; label: string; workspace?: string }>
  warnings: string[]
  page: HistoryPage
}
export type ReferenceBranchInput = {
  path?: string; referenceId?: string; cutoffTurnId?: string; workspace?: string
  model?: string; providerId?: string; idempotencyKey: string
}

export async function historyRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await rendererRuntimeClient.runtimeRequest(
    path, body === undefined ? 'GET' : 'POST',
    body === undefined ? undefined : JSON.stringify(body), { signal }
  )
  let result: any
  try { result = JSON.parse(response.body) } catch { result = null }
  if (!response.ok) throw new Error(result?.message || result?.error?.message || `HTTP ${response.status}`)
  if (!result) throw new Error('Invalid history response')
  return result as T
}

export function createReferenceBranch(input: ReferenceBranchInput): Promise<{
  thread: CoreThreadSummaryJson; reference: HistoryReference
}> {
  return historyRequest('/v1/threads/reference-branches', input)
}

export function historyBlocks(turn: CoreTurnJson): ChatBlock[] {
  return mergeChatBlocks((turn.items ?? []).map((item) => chatBlockFromItem(item))
    .filter((block): block is ChatBlock => block !== null))
}

export function isSourceHistoryTurn(turn: { turnId?: string }): boolean {
  return turn.turnId?.startsWith('codex:') === true
}
