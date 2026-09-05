import type {
  TrajectoryRecord,
  TrajectoryRequestRecord,
  TrajectoryToolRecord
} from '../../agent/trajectory'

export type HarnessCellKind =
  | 'system'
  | 'user'
  | 'context'
  | 'compacted'
  | 'assistant'
  | 'tool'
  | 'subtool'
  | 'request'

export type HarnessRequestBoundary = {
  number: number
  request: TrajectoryRequestRecord
}

export type HarnessCell = {
  id: string
  index: number
  kind: HarnessCellKind
  turnId: string
  turn: number
  step: number
  text: string
  thinking: string
  result: string
  status: TrajectoryRecord['status']
  startedAt: number | null
  durationMs: number | null
  request?: HarnessRequestBoundary
  record: TrajectoryRecord
  parentRequestId?: string
  parentCallId?: string
  callId?: string
  attachmentIds: readonly string[]
  requestOnly?: boolean
  collapsedSummary?: 'turn' | 'calls'
}

export type HarnessTurn = {
  id: string
  number: number
  cells: HarnessCell[]
}

export type HarnessLayout = {
  turns: HarnessTurn[]
  cells: HarnessCell[]
  requests: HarnessRequestBoundary[]
}

export function deriveHarnessLayout(records: readonly TrajectoryRecord[]): HarnessLayout {
  const ordered = [...records].sort(oldestFirst)
  const requests = ordered
    .filter((record): record is TrajectoryRequestRecord => record.kind === 'llm_request')
    .map((request, index) => ({ number: index + 1, request }))
  const turnNumber = new Map<string, number>()
  const turns = new Map<string, HarnessTurn>()
  let nextTurn = 0
  let nextIndex = 0

  for (const record of ordered) {
    if (record.kind === 'llm_request') continue
    const initialSystem = record.kind === 'system' && !record.previousPromptFingerprint
    const groupId = initialSystem ? `system:${record.id}` : record.turnId
    let number = turnNumber.get(groupId)
    if (number === undefined) {
      number = initialSystem ? 0 : ++nextTurn
      turnNumber.set(groupId, number)
    }
    const turn = turns.get(groupId) ?? { id: groupId, number, cells: [] }
    const parentRequestId = record.parentRequestId
    const cell: HarnessCell = {
      id: record.id,
      index: ++nextIndex,
      kind: record.kind,
      turnId: groupId,
      turn: number,
      step: record.step,
      text: record.preview,
      thinking: record.kind === 'assistant' ? record.thinkingPreview : '',
      result: record.kind === 'tool' || record.kind === 'subtool' ? record.resultPreview : '',
      status: record.status,
      startedAt: time(record.startedAt),
      durationMs: record.durationMs ?? null,
      record,
      ...(parentRequestId ? { parentRequestId } : {}),
      ...((record.kind === 'tool' || record.kind === 'subtool')
        ? {
            callId: record.callId,
            ...(record.parentCallId ? { parentCallId: record.parentCallId } : {})
          }
        : {}),
      attachmentIds: record.attachmentIds
    }
    turn.cells.push(cell)
    turns.set(groupId, turn)
  }

  for (const boundary of requests) {
    const cells = [...turns.values()].flatMap((turn) => turn.cells)
    const candidates = cells.filter((cell) => cell.parentRequestId === boundary.request.requestId)
    const target = candidates.find((cell) => cell.kind === 'assistant')
      ?? candidates.find((cell) => cell.kind !== 'system')
      ?? candidates[0]
    if (target) {
      target.request = boundary
      continue
    }
    let number = turnNumber.get(boundary.request.turnId)
    if (number === undefined) {
      number = ++nextTurn
      turnNumber.set(boundary.request.turnId, number)
    }
    const turn = turns.get(boundary.request.turnId) ?? {
      id: boundary.request.turnId,
      number,
      cells: []
    }
    turn.cells.push({
      id: `boundary:${boundary.request.requestId}`,
      index: ++nextIndex,
      kind: 'request',
      turnId: boundary.request.turnId,
      turn: number,
      step: boundary.request.step,
      text: '',
      thinking: '',
      result: '',
      status: boundary.request.status,
      startedAt: time(boundary.request.startedAt),
      durationMs: boundary.request.durationMs ?? null,
      request: boundary,
      record: boundary.request,
      parentRequestId: boundary.request.requestId,
      attachmentIds: [],
      requestOnly: true
    })
    turns.set(boundary.request.turnId, turn)
  }
  for (const turn of turns.values()) {
    turn.cells.sort((left, right) =>
      (left.startedAt ?? 0) - (right.startedAt ?? 0) || Number(left.requestOnly) - Number(right.requestOnly))
  }
  const cells = [...turns.values()].flatMap((turn) => turn.cells)
  cells.forEach((cell, index) => { cell.index = index + 1 })
  return { turns: [...turns.values()], cells, requests }
}

export function projectHarnessCells(input: {
  layout: HarnessLayout
  collapsedTurns: ReadonlySet<string>
  collapsedCalls: ReadonlySet<string>
  searchQuery: string
}): HarnessCell[] {
  const query = input.searchQuery.trim().toLocaleLowerCase()
  if (query) return input.layout.cells.filter((cell) => searchText(cell).includes(query))
  const projected: HarnessCell[] = []
  for (const turn of input.layout.turns) {
    if (input.collapsedTurns.has(turn.id) && turn.cells.length > 1) {
      const first = turn.cells[0]
      if (first) projected.push({
        ...first,
        id: `${first.id}:turn-summary`,
        text: turn.cells.map((cell) => cell.text).filter(Boolean).join(' · '),
        collapsedSummary: 'turn'
      })
      continue
    }
    for (let index = 0; index < turn.cells.length; index += 1) {
      const cell = turn.cells[index]!
      projected.push(cell)
      if (cell.kind !== 'assistant' || !input.collapsedCalls.has(cell.id)) continue
      const calls: HarnessCell[] = []
      while (turn.cells[index + 1]?.parentRequestId === cell.parentRequestId &&
        ['tool', 'subtool'].includes(turn.cells[index + 1]!.kind)) {
        calls.push(turn.cells[++index]!)
      }
      if (calls.length) projected.push({
        ...calls[0]!,
        id: `${cell.id}:calls-summary`,
        text: calls.map((call) => toolRecord(call)?.toolName ?? call.text).join(' · '),
        result: '',
        collapsedSummary: 'calls'
      })
    }
  }
  return projected
}

export function cellSearchIndex(cells: readonly HarnessCell[]): Map<string, string> {
  return new Map(cells.map((cell) => [cell.id, searchText(cell)]))
}

export function toolRecord(cell: HarnessCell): TrajectoryToolRecord | null {
  return cell.record.kind === 'tool' || cell.record.kind === 'subtool'
    ? cell.record
    : null
}

function searchText(cell: HarnessCell): string {
  const tool = toolRecord(cell)
  return [
    cell.kind, cell.text, cell.thinking, cell.result, cell.status,
    tool?.toolName, tool?.argumentPreview, tool?.errorMessage,
    cell.request?.request.model, cell.request?.request.provider,
    cell.request?.request.requestId
  ].filter(Boolean).join('\n').toLocaleLowerCase()
}

function oldestFirst(left: TrajectoryRecord, right: TrajectoryRecord): number {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
}

function time(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
