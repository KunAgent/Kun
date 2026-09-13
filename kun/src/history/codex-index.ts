import { basename, dirname, isAbsolute, resolve } from 'node:path'
import type { HistorySourceFile } from '../contracts/history-reference.js'
import { readCodexLines, object, string, type CodexLine } from './codex-jsonl.js'
import { isCodexPath, resolveCodexParentPath } from './codex-discovery.js'
import { projectCodexRecord } from './codex-projection.js'
import { isCodexUserTurnBoundary } from './codex-turn-boundary.js'

export interface IndexedItem {
  blockIndex?: number
  offset: number
  ordinal: number
  kind: string
  toolName?: string
  callId?: string
  missingResult?: boolean
}
export interface IndexedTurn {
  id: string
  createdAt: string
  label: string
  filePath: string
  workspace: string
  items: IndexedItem[]
  complete: boolean
  countsAsUserTurn: boolean
  boundary: HistorySourceFile
}
export interface CodexIndex {
  path: string
  sessionId: string
  title: string
  workspace: string
  createdAt: string
  updatedAt: string
  turns: IndexedTurn[]
  files: HistorySourceFile[]
  warnings: string[]
  lastOrdinal?: number
}

export async function indexCodexFile(
  path: string,
  options: {
    byteLimit?: number; parents?: Set<string>; parentLimits?: Map<string, number>; parentPaths?: Map<string, string>
  } = {}
): Promise<CodexIndex> {
  path = resolve(path)
  const parents = new Set(options.parents)
  if (parents.has(path) || parents.size >= 16) throw new Error('Codex parent history contains a cycle or exceeds 16 files.')
  parents.add(path)
  const index: CodexIndex = {
    path, sessionId: basename(path).replace(/\.jsonl(?:\.zst)?$/, ''), title: '', workspace: '',
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), turns: [], files: [], warnings: []
  }
  const warnings = new Set<string>()
  let current: IndexedTurn | undefined
  let turnContext = ''
  let currentTurnId = ''
  let initialWorkspace = ''
  let sequence = 0
  let explicitLifecycle = false
  let last: CodexLine | undefined
  let pending = new Set<string>()
  const source = (line: CodexLine): HistorySourceFile => ({
    path, sessionId: index.sessionId, byteLength: line.end, sha256: line.sha256, recordCount: line.ordinal
  })
  const includeParent = async (value: unknown): Promise<void> => {
    const base = object(value)
    let relative = options.parentPaths?.get(string(base.thread_id)) || (typeof value === 'string' ? value
      : string(base.path) || string(base.rollout_path) || string(base.file_path))
    if (!relative && string(base.thread_id)) relative = await resolveCodexParentPath(path, string(base.thread_id)) || ''
    if (!relative || !isCodexPath(relative)) { warnings.add('Parent history file could not be resolved.'); return }
    const parentPath = isAbsolute(relative) ? relative : resolve(dirname(path), relative)
    if (options.parentLimits && !options.parentLimits.has(parentPath)) {
      warnings.add('Parent history was unavailable when this branch was created.')
      return
    }
    try {
      const limit = options.parentLimits?.get(parentPath) ??
        (typeof base.end_byte_offset === 'number' ? base.end_byte_offset :
          typeof base.byte_length === 'number' ? base.byte_length : undefined)
      const parent = await indexCodexFile(parentPath, { byteLimit: limit, parents, parentLimits: options.parentLimits, parentPaths: options.parentPaths })
      if (string(base.thread_id) && parent.sessionId !== base.thread_id) { warnings.add('Parent history identity does not match.'); return }
      if (typeof base.end_ordinal_exclusive === 'number' && parent.lastOrdinal !== undefined &&
        parent.lastOrdinal + 1 !== base.end_ordinal_exclusive) { warnings.add('Parent history ordinal boundary does not match.'); return }
      const parentSource = parent.files.find((file) => file.path === parent.path)
      if (limit !== undefined && parentSource?.byteLength !== limit) { warnings.add('Parent history cutoff is unavailable.'); return }
      let turns = parent.turns
      const cutoff = string(base.cutoff_turn_id) || string(base.turn_id)
      if (cutoff) {
        const lastIndex = turns.findIndex((turn) => turn.id === cutoff || turn.id.endsWith(`:${cutoff}`))
        if (lastIndex < 0) { warnings.add('Parent history cutoff could not be resolved.'); return }
        turns = turns.slice(0, lastIndex + 1)
      }
      index.turns.push(...turns)
      const final = turns.at(-1)
      index.workspace ||= final?.workspace || parent.workspace
      index.files.push(...parent.files.filter((file) => file.path !== parent.path))
      if (cutoff && final) index.files.push(final.boundary)
      else if (parentSource) index.files.push(parentSource)
      parent.warnings.forEach((warning) => warnings.add(warning))
    } catch { warnings.add('Parent history file is missing or could not be read.') }
  }
  const beginTurn = (line: CodexLine, timestamp: string, identity: string): void => {
    sequence += 1
    currentTurnId = identity
    current = {
      id: `codex:${index.sessionId}:${identity || `record-${line.ordinal}`}`, createdAt: timestamp,
      label: '', filePath: path, workspace: index.workspace, items: [], complete: false,
      countsAsUserTurn: false, boundary: source(line)
    }
    if (index.turns.some((turn) => turn.id === current?.id)) current.id += `:${sequence}`
    index.turns.push(current)
    pending = new Set()
  }
  for await (const line of readCodexLines(path, options.byteLimit)) {
    if (line.malformed) { warnings.add('Malformed, oversized or incomplete Codex records were skipped.'); continue }
    last = line
    const record = line.value
    if (typeof record.ordinal === 'number') index.lastOrdinal = record.ordinal
    const payload = object(record.payload)
    const timestamp = string(record.timestamp) || index.updatedAt
    index.updatedAt = timestamp
    if (record.type === 'session_meta') {
      index.sessionId = string(payload.id) || index.sessionId
      index.workspace = string(payload.cwd) || index.workspace
      index.createdAt = string(payload.timestamp) || timestamp
      index.title = string(payload.title).slice(0, 120)
      if (payload.history_base) await includeParent(payload.history_base)
      initialWorkspace = index.workspace
      continue
    }
    if (record.type === 'history_base') {
      if (current) warnings.add('A parent reference after conversation content was skipped.')
      else {
        await includeParent(record.payload)
        initialWorkspace ||= index.workspace
      }
      continue
    }
    if (record.type === 'turn_context') {
      turnContext = string(payload.turn_id)
      index.workspace = string(payload.cwd) || index.workspace
      if (current && !current.complete && (!turnContext || !currentTurnId || currentTurnId === turnContext)) {
        current.workspace = index.workspace
      }
      // Older start events omit the ID; the following context supplies it.
      if (current && explicitLifecycle && !currentTurnId && turnContext) {
        currentTurnId = turnContext
        current.id = `codex:${index.sessionId}:${turnContext}`
        if (index.turns.some((turn) => turn !== current && turn.id === current?.id)) current.id += `:${sequence}`
      }
      continue
    }
    if (record.type === 'event_msg') {
      if (payload.type === 'task_started' || payload.type === 'turn_started') {
        explicitLifecycle = true
        const identity = string(payload.turn_id)
        if (!current || current.complete || !identity || currentTurnId !== identity) beginTurn(line, timestamp, identity)
        turnContext = identity
      }
      if (payload.type === 'task_complete' || payload.type === 'turn_complete' || payload.type === 'task_completed') {
        if (current && (!string(payload.turn_id) || currentTurnId === string(payload.turn_id))) {
          current.complete = pending.size === 0; current.boundary = source(line); explicitLifecycle = false
        }
      }
      if (payload.type === 'thread_rolled_back' || payload.type === 'session_rollback') {
        const count = Number(payload.num_turns ?? payload.turns)
        if (Number.isSafeInteger(count) && count > 0) {
          let start = index.turns.length
          let remaining = count
          let cutoff: number | undefined
          while (start > 0 && remaining > 0) {
            start -= 1
            if (index.turns[start].countsAsUserTurn) {
              remaining -= 1
              cutoff = start
            }
          }
          // Like Codex, retain records before the earliest actual input when
          // a rollback exceeds the number of available input boundaries.
          if (cutoff !== undefined) index.turns.splice(cutoff)
          index.workspace = index.turns.at(-1)?.workspace || initialWorkspace
          current = undefined
          turnContext = ''
          currentTurnId = ''
          explicitLifecycle = false
          pending = new Set()
        }
      }
      continue
    }
    if (record.type === 'compacted') {
      if (!index.turns.length) warnings.add('History before the Codex compaction is not present in this source.')
      continue
    }
    const projected = projectCodexRecord(record)
    const inputBoundary = isCodexUserTurnBoundary(record)
    const newContext = Boolean(turnContext && currentTurnId !== turnContext)
    const newUserTurn = inputBoundary &&
      (!current || current.complete || (!turnContext && !explicitLifecycle))
    if ((projected.length || inputBoundary) && (newContext || newUserTurn)) beginTurn(line, timestamp, turnContext)
    if (current && inputBoundary) {
      current.countsAsUserTurn = true
      current.boundary = source(line)
    }
    for (const item of projected) {
      if (!current) {
        warnings.add('Codex content without a recoverable turn was skipped.')
        continue
      }
      if ('text' in item && (!current.label || (item.kind === 'user_message' && !current.items.some((entry) => entry.kind === 'user_message')))) {
        current.label = item.text.replace(/\s+/g, ' ').slice(0, 160)
        if (!index.title) index.title = current.label.slice(0, 120)
      }
      const pointer: IndexedItem = { offset: line.offset, ordinal: line.ordinal, kind: item.kind }
      if (item.kind === 'tool_call') {
        pending.add(item.callId)
        pointer.callId = item.callId
        pointer.toolName = item.toolName
        current.complete = false
      }
      if (item.kind === 'tool_result') {
        pending.delete(item.callId)
        pointer.callId = item.callId
        pointer.toolName = current.items.find((entry) => entry.callId === item.callId)?.toolName || item.toolName
      }
      current.items.push(pointer)
      current.boundary = source(line)
      if (item.kind === 'assistant_text' && !inputBoundary && (payload.channel ?? payload.phase) !== 'commentary' && !explicitLifecycle && pending.size === 0) {
        current.complete = true
      }
    }
    if (record.type === 'response_item' && !projected.length &&
      !['message', 'reasoning'].includes(string(payload.type))) warnings.add('Unsupported Codex response records were skipped.')
  }
  if (current && pending.size > 0) warnings.add('The last Codex turn has missing tool results and cannot be a branch point.')
  for (const turn of index.turns) {
    const results = new Set(turn.items.filter((item) => item.kind === 'tool_result').map((item) => item.callId))
    for (const item of turn.items) {
      if (item.kind === 'tool_call' && !results.has(item.callId)) item.missingResult = true
    }
  }
  if (last) index.files.push(source(last))
  index.title ||= 'Codex conversation'
  index.warnings = [...warnings].slice(0, 32)
  return index
}
