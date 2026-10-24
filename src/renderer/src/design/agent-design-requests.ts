import { create } from 'zustand'
import type { ChatBlock, ToolBlock } from '../agent/types'
import {
  readDesignOpenRequest,
  type DesignOpenRequestMetadata
} from '../agent/design-open-request'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

/**
 * Lifecycle of a Code-agent `design_open` request inside the workbench.
 *
 * `waiting` is recorded only while the requesting turn is live in this window,
 * so reopening an old conversation never starts a design pass by itself;
 * those requests read as `not-started` and offer a manual start instead.
 */
export type AgentDesignRequestPhase =
  | 'waiting'
  | 'starting'
  | 'running'
  | 'ready'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type AgentDesignRequestRecord = {
  requestId: string
  threadId: string
  turnId: string
  phase: AgentDesignRequestPhase
  sessionId: string
  updatedAt: number
  error?: string
}

type AgentDesignRequestState = {
  records: Record<string, AgentDesignRequestRecord>
  manualStarts: string[]
  setPhase: (
    requestId: string,
    patch: Pick<AgentDesignRequestRecord, 'threadId' | 'turnId' | 'phase'> & { error?: string }
  ) => void
  requestStart: (requestId: string) => void
  takeManualStarts: () => string[]
}

const STORAGE_KEY = 'kun.agentDesignRequests.v1'
const MAX_RECORDS = 200

export const AGENT_DESIGN_SESSION_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function isPhase(value: unknown): value is AgentDesignRequestPhase {
  return value === 'waiting' || value === 'starting' || value === 'running' || value === 'ready' ||
    value === 'failed' || value === 'skipped' || value === 'cancelled'
}

/** A record from an earlier window can no longer be advanced by this one. */
export function settleForeignRecord(record: AgentDesignRequestRecord): AgentDesignRequestRecord {
  if (record.sessionId === AGENT_DESIGN_SESSION_ID) return record
  if (record.phase === 'waiting' || record.phase === 'starting') return { ...record, phase: 'cancelled' }
  if (record.phase === 'running') return { ...record, phase: 'ready' }
  return record
}

function readRecords(): Record<string, AgentDesignRequestRecord> {
  try {
    const raw = readBrowserStorageItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    const records: Record<string, AgentDesignRequestRecord> = {}
    for (const [requestId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as Partial<AgentDesignRequestRecord>
      if (
        candidate.requestId !== requestId ||
        typeof candidate.threadId !== 'string' ||
        typeof candidate.turnId !== 'string' ||
        !isPhase(candidate.phase)
      ) continue
      records[requestId] = settleForeignRecord({
        requestId,
        threadId: candidate.threadId,
        turnId: candidate.turnId,
        phase: candidate.phase,
        sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : '',
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
        ...(typeof candidate.error === 'string' ? { error: candidate.error } : {})
      })
    }
    return records
  } catch {
    return {}
  }
}

function writeRecords(records: Record<string, AgentDesignRequestRecord>): Record<string, AgentDesignRequestRecord> {
  const kept = Object.values(records)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECORDS)
  const next = Object.fromEntries(kept.map((record) => [record.requestId, record]))
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export const useAgentDesignRequestStore = create<AgentDesignRequestState>((set, get) => ({
  records: readRecords(),
  manualStarts: [],
  setPhase: (requestId, patch) => {
    const current = get().records[requestId]
    const record: AgentDesignRequestRecord = {
      requestId,
      threadId: patch.threadId,
      turnId: patch.turnId,
      phase: patch.phase,
      sessionId: AGENT_DESIGN_SESSION_ID,
      updatedAt: Date.now(),
      ...(patch.error ? { error: patch.error } : {})
    }
    if (current && current.phase === record.phase && current.error === record.error) return
    set({ records: writeRecords({ ...get().records, [requestId]: record }) })
  },
  requestStart: (requestId) => {
    if (get().manualStarts.includes(requestId)) return
    set({ manualStarts: [...get().manualStarts, requestId] })
  },
  takeManualStarts: () => {
    const starts = get().manualStarts
    if (starts.length) set({ manualStarts: [] })
    return starts
  }
}))

export type DesignOpenBlockRef = {
  block: ToolBlock
  request: DesignOpenRequestMetadata & { requestId: string }
}

/** Queued design requests in timeline order. */
export function queuedDesignOpenBlocks(blocks: readonly ChatBlock[]): DesignOpenBlockRef[] {
  const refs: DesignOpenBlockRef[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool') continue
    const request = readDesignOpenRequest(block)
    if (request?.status !== 'queued' || !request.requestId) continue
    refs.push({ block, request: { ...request, requestId: request.requestId } })
  }
  return refs
}

/**
 * One reply may call `design_open` more than once; only the last request runs
 * so the canvas reflects the agent's final brief.
 */
export function partitionTurnRequests(
  refs: readonly DesignOpenBlockRef[],
  turnId: string
): { run: DesignOpenBlockRef | null; skip: DesignOpenBlockRef[] } {
  const inTurn = refs.filter((ref) => ref.block.turnId === turnId)
  const run = inTurn.at(-1) ?? null
  return { run, skip: run ? inTurn.slice(0, -1) : [] }
}

export type DesignOpenCardState =
  | 'pending'
  | 'failed'
  | 'queued'
  | 'starting'
  | 'designing'
  | 'ready'
  | 'not-started'
  | 'start-failed'
  | 'superseded'

export function deriveDesignOpenCardState(input: {
  request: DesignOpenRequestMetadata
  record?: AgentDesignRequestRecord
  /** The requesting reply is still streaming in this window. */
  requestTurnLive: boolean
  threadBusy: boolean
  threadHasDesign: boolean
}): DesignOpenCardState {
  if (input.request.status === 'failed') return 'failed'
  if (input.request.status === 'pending' || !input.request.requestId) {
    return input.requestTurnLive ? 'pending' : 'failed'
  }
  switch (input.record?.phase) {
    case 'waiting': return 'queued'
    case 'starting': return 'starting'
    case 'running': return input.threadBusy ? 'designing' : 'ready'
    case 'ready': return 'ready'
    case 'failed': return 'start-failed'
    case 'skipped': return 'superseded'
    case 'cancelled': return input.threadHasDesign ? 'ready' : 'not-started'
    default:
      if (input.requestTurnLive) return 'queued'
      return input.threadHasDesign ? 'ready' : 'not-started'
  }
}

/** Prompt the Design pass receives; the conversation history supplies the rest. */
export function agentDesignPassPrompt(request: Pick<DesignOpenRequestMetadata, 'title' | 'brief'>): string {
  return [
    `Design request from the coding agent in this conversation: ${request.title}`,
    '',
    request.brief.trim() || request.title
  ].join('\n')
}
