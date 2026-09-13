import { basename, resolve } from 'node:path'
import type { HistorySourceFile } from '../contracts/history-reference.js'
import type { CodexIndex, IndexedItem, IndexedTurn } from './codex-index.js'
import { HistorySourceError, object, readCodexLines, string } from './codex-jsonl.js'
import { isClaudeInput, projectClaudeRecord } from './claude-projection.js'

type Node = {
  uuid: string; parent: string; source: HistorySourceFile; timestamp: string; workspace: string
  input: boolean; label: string; items: IndexedItem[]; finished: boolean; compact: boolean
}

/** Retain graph/offset metadata only. Bodies are hydrated from the verified prefix on demand. */
export async function indexClaudeFile(path: string, options: { byteLimit?: number } = {}): Promise<CodexIndex> {
  path = resolve(path)
  if (!/\.jsonl(?:\.zst)?$/iu.test(path)) throw new HistorySourceError('partial', 'Select a Claude Code JSONL file.')
  const index: CodexIndex = { path, sessionId: '', title: '', workspace: '', createdAt: '', updatedAt: '', turns: [], files: [], warnings: [] }
  const nodes = new Map<string, Node>()
  const warnings = new Set<string>()
  let latest: Node | undefined
  let lastCompact: Node | undefined
  let lastSource: HistorySourceFile | undefined
  let customTitle = ''
  for await (const line of readCodexLines(path, options.byteLimit)) {
    if (line.malformed) { warnings.add('Malformed or incomplete Claude Code records were skipped.'); continue }
    const r = line.value
    const sessionId = string(r.sessionId)
    if (sessionId && index.sessionId && sessionId !== index.sessionId) throw new HistorySourceError('partial', 'Mixed Claude Code session identities are unsupported.')
    index.sessionId ||= sessionId
    lastSource = { path, sessionId: index.sessionId, byteLength: line.end, sha256: line.sha256, recordCount: line.ordinal }
    if (r.isSidechain === true) continue
    if (r.type === 'custom-title') customTitle = string(r.customTitle).slice(0, 120)
    if (r.type === 'ai-title') index.title = string(r.aiTitle).slice(0, 120)
    const uuid = string(r.uuid)
    if (!uuid || !['user', 'assistant', 'system', 'attachment'].includes(string(r.type))) continue
    const projected = projectClaudeRecord(r)
    const items: IndexedItem[] = projected.map((item, blockIndex) => ({
      offset: line.offset, ordinal: 0, blockIndex, kind: item.kind,
      ...('callId' in item ? { callId: item.callId, toolName: item.toolName } : {})
    }))
    const compact = r.type === 'system' && r.subtype === 'compact_boundary'
    const node: Node = { uuid, parent: string(r.parentUuid) || string(r.logicalParentUuid) ||
      (compact ? latest?.uuid : r.isCompactSummary === true ? lastCompact?.uuid : '') || '',
      source: lastSource, timestamp: string(r.timestamp), workspace: string(r.cwd),
      input: isClaudeInput(r), items,
      label: projected.filter((item) => item.kind === 'user_message').map((item) => 'text' in item ? item.text : '').join(' ').replace(/\s+/gu, ' ').slice(0, 160),
      finished: r.type === 'assistant' && !r.isApiErrorMessage && ['end_turn', 'stop_sequence'].includes(string(object(r.message).stop_reason)),
      compact }
    nodes.set(uuid, node)
    if (compact) lastCompact = node
    if (r.type === 'user' || r.type === 'assistant') latest = node
    if (node.compact) warnings.add('Claude Code context was compacted; only recoverable source history is shown.')
  }
  if (!index.sessionId || !latest) throw new HistorySourceError('partial', 'This file has no supported Claude Code main conversation.')
  const chain: Node[] = []
  const seen = new Set<string>()
  let node: Node | undefined = latest
  while (node) {
    if (seen.has(node.uuid)) throw new HistorySourceError('partial', 'Claude Code message parents contain a cycle.')
    seen.add(node.uuid); chain.push(node)
    if (!node.parent) break
    const parent = nodes.get(node.parent)
    if (!parent) { warnings.add('Some Claude Code parent messages are missing.'); break }
    node = parent
  }
  chain.reverse()
  let current: IndexedTurn | undefined
  let ordinal = 0
  const pending = new Set<string>()
  for (const entry of chain) {
    index.workspace = entry.workspace || index.workspace
    index.createdAt ||= entry.timestamp
    index.updatedAt = entry.timestamp || index.updatedAt
    if (entry.input || (!current && entry.items.length)) {
      current = { id: `claude-code:${index.sessionId}:${entry.uuid}`, createdAt: entry.timestamp,
        label: entry.label || 'Claude Code history', filePath: path, workspace: index.workspace,
        items: [], complete: false, countsAsUserTurn: entry.input, boundary: entry.source }
      index.turns.push(current); pending.clear()
    }
    if (!current) continue
    current.workspace = index.workspace
    for (const item of entry.items) {
      item.ordinal = ++ordinal
      if (item.kind === 'tool_call') { pending.add(item.callId!); current.complete = false }
      if (item.kind === 'tool_result') {
        pending.delete(item.callId!)
        item.toolName = current.items.find((candidate) => candidate.kind === 'tool_call' && candidate.callId === item.callId)?.toolName || item.toolName
      }
      current.items.push(item)
    }
    current.boundary = entry.source
    if (entry.finished && pending.size === 0) current.complete = true
  }
  for (const turn of index.turns) {
    const results = new Set(turn.items.filter((item) => item.kind === 'tool_result').map((item) => item.callId))
    turn.items.forEach((item) => { if (item.kind === 'tool_call' && !results.has(item.callId)) item.missingResult = true })
  }
  if (current && !current.complete) warnings.add('The unfinished Claude Code tail is not available as a branch point.')
  index.title = customTitle || index.title || index.turns.find((turn) => turn.countsAsUserTurn)?.label || basename(path)
  if (lastSource) index.files = [{ ...lastSource, sessionId: index.sessionId }]
  index.warnings = [...warnings]
  return index
}
