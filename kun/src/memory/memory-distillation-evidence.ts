import { createHash } from 'node:crypto'
import type { TurnItem, ToolResultTurnItem } from '../contracts/items.js'
import type { MemorySourceEvidence } from '../contracts/memory.js'

export function buildTurnMemoryEvidence(input: {
  threadId: string; turnId: string; userText: string; assistantText: string; items: readonly TurnItem[]
}): MemorySourceEvidence[] {
  const result = [
    textSource('user', 'explicit-user', input.userText, input.threadId, input.turnId),
    textSource('inference', 'inferred', input.assistantText, input.threadId, input.turnId)
  ]
  const tools = input.items.filter((item) => item.kind === 'tool_result').map((item) => ({
    item, outcome: executionOutcome(item), output: executionOutput(item)
  }))
  // Preserve adverse outcomes first, so a long successful tail cannot erase a failed receipt.
  tools.sort((left, right) => Number(adverse(right.outcome)) - Number(adverse(left.outcome)))
  for (const { item, outcome, output } of tools.slice(0, 6)) {
    const serialized = typeof item.output === 'string' ? item.output : JSON.stringify(item.output) ?? ''
    const source = textSource('tool', 'observed', serialized, input.threadId, input.turnId)
    source.id = 'src_' + hash([input.threadId, input.turnId, item.id, source.contentHash].join('\0')).slice(0, 24)
    source.itemId = item.id
    source.receiptId = item.id
    source.locator = `thread:${input.threadId}/turn:${input.turnId}/item:${item.id}`.slice(0, 1024)
    source.outcome = outcome
    const sha = output.repositorySha ?? output.versionHash ?? output.commitSha
    if (typeof sha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) source.repositorySha = sha
    const artifacts = [output.logArtifactId, output.artifactId, ...(Array.isArray(output.artifactIds) ? output.artifactIds : [])]
      .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256)
    if (artifacts.length) source.artifactIds = [...new Set(artifacts)].slice(0, 8)
    result.push(source)
  }
  return result
}

function executionOutput(item: ToolResultTurnItem): Record<string, unknown> {
  return item.output && typeof item.output === 'object' && !Array.isArray(item.output)
    ? item.output as Record<string, unknown> : {}
}
function executionOutcome(item: ToolResultTurnItem): NonNullable<MemorySourceEvidence['outcome']> {
  const output = executionOutput(item)
  if (item.status === 'aborted') return 'aborted'
  if (item.isError || item.status === 'failed') return 'failed'
  const records = item.toolName === 'background_shell' && Array.isArray(output.sessions)
    ? output.sessions.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [output]
  const outcomes = records.map((record) => {
    const exitCode = record.exitCode ?? record.exit_code
    if (record.aborted === true || ['aborted', 'cancelled', 'killed'].includes(String(record.status))) return 'aborted' as const
    if (record.timedOut === true || record.timed_out === true || ['failed', 'timed_out'].includes(String(record.status)) ||
      typeof exitCode === 'number' && exitCode !== 0) return 'failed' as const
    return item.status === 'completed' && item.toolKind === 'command_execution' && exitCode === 0 &&
      (record.status === undefined || record.status === 'completed') ? 'succeeded' as const : 'unknown' as const
  })
  if (outcomes.includes('aborted')) return 'aborted'
  if (outcomes.includes('failed')) return 'failed'
  return outcomes.length && outcomes.every((outcome) => outcome === 'succeeded') ? 'succeeded' : 'unknown'
}

function adverse(outcome: MemorySourceEvidence['outcome']): boolean { return outcome === 'failed' || outcome === 'aborted' }

function textSource(kind: 'user' | 'inference' | 'tool', trust: 'explicit-user' | 'inferred' | 'observed',
  text: string, threadId: string, turnId: string): MemorySourceEvidence {
  const contentHash = hash(text)
  return { id: `src_${hash([threadId, turnId, kind, contentHash].join('\0')).slice(0, 24)}`,
    kind, threadId, turnId, ...(text ? { excerpt: text.slice(0, 512) } : {}), contentHash, trust }
}
function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
