import type {RemoteResource } from '../resources/contracts.js'
export type SourceSearchCoverage = 'not_applicable' | 'pending' | 'scanning' | 'complete' | 'disabled' | 'missing' | 'changed' | 'partial' | 'unavailable'
export type RemoteMessageMatch = { resource: RemoteResource; messageId: string; historyVersion: string; turnId?: string;
  kind: string; role?: string; snippet: string; createdAt: string; sourceHistoryOrder?: { referenceId: string; turnIndex: number; itemIndex: number } }
export type MessageSearchResult = { messages: RemoteMessageMatch[]; hasMore: boolean; nextCursor?: string; complete: boolean;
  coverage: { native: 'scanning' | 'complete' | 'unavailable'; source: SourceSearchCoverage; referenceId?: string } }
export type SourceSearchPosition = { before?: string; anchor?: string; offset?: number; partial?: boolean }
export const messageSnippet = (text: string, query: string) => {
  const at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase())), start = Math.max(0, at - 80)
  return (start ? '…' : '') + text.slice(start, start + 320).replace(/\s+/g, ' ') + (text.length > start + 320 ? '…' : '')
}
