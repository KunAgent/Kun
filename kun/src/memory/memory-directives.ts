import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MEMORY_DIRECTIVE_MAX_CONTENT_CHARS,
  type MemoryRecord
} from '../contracts/memory.js'
import { agentMemoryVisible } from './agent-memory-scope.js'
import { formatMemoryDirectiveLine } from './memory-directive-format.js'
import { memoryInScope } from './memory-ranking.js'
import { filterActiveMemories } from './memory-retrieval.js'
import type { MemoryAccess } from './memory-store.js'

export const MEMORY_DIRECTIVE_DEFAULT_MAX_RECORDS = 20
export const MEMORY_DIRECTIVE_DEFAULT_MAX_CHARACTERS = 4_000

export type MemoryDirectiveResult = {
  records: MemoryRecord[]
  excludedByBudget: string[]
  truncatedIds: string[]
  characters: number
}

/**
 * Selects the standing rules injected into every turn. Unlike retrieve() this
 * is not relevance-gated: every active, in-scope directive is eligible and only
 * the record/character budgets trim the tail of a stable ordering. User-wide
 * rules sort before workspace rules so the more specific scope renders last.
 */
export function selectMemoryDirectives(input: {
  records: readonly MemoryRecord[]
  access?: MemoryAccess
  policy?: MemoryCapabilityConfig
  nowMs?: number
}): MemoryDirectiveResult {
  const policy = input.policy
  const enabled = policy?.enabled !== false && policy?.directives?.enabled !== false
  const maxRecords = Math.max(1, Math.floor(
    policy?.directives?.maxRecords ?? MEMORY_DIRECTIVE_DEFAULT_MAX_RECORDS
  ))
  const maxCharacters = Math.max(0, Math.floor(
    policy?.directives?.maxCharacters ?? MEMORY_DIRECTIVE_DEFAULT_MAX_CHARACTERS
  ))
  const nowMs = input.nowMs ?? Date.now()
  const access = input.access ?? {}
  const empty: MemoryDirectiveResult = { records: [], excludedByBudget: [], truncatedIds: [], characters: 0 }
  if (!enabled) return empty

  const scoped = input.records
    .filter((record) => record.authority === 'directive')
    .filter((record) => !record.agentContext)
    .filter((record) => agentMemoryVisible(record, access))
    .filter((record) => memoryInScope(record, access))
  const active = filterActiveMemories(scoped, nowMs)
  const truncatedIds = active
    .filter((record) => record.content.length > MEMORY_DIRECTIVE_MAX_CONTENT_CHARS)
    .map((record) => record.id)
  const eligible = active
    .filter((record) => record.content.length <= MEMORY_DIRECTIVE_MAX_CONTENT_CHARS)
    .sort(compareMemoryDirectives)

  const records: MemoryRecord[] = []
  const excludedByBudget: string[] = []
  let characters = 0
  for (const record of eligible) {
    const lineCharacters = formatMemoryDirectiveLine(record).length + 1
    if (records.length >= maxRecords || characters + lineCharacters > maxCharacters) {
      excludedByBudget.push(record.id)
      continue
    }
    records.push(record)
    characters += lineCharacters
  }
  return { records, excludedByBudget, truncatedIds, characters }
}

function compareMemoryDirectives(left: MemoryRecord, right: MemoryRecord): number {
  return directiveScopeRank(left.scope) - directiveScopeRank(right.scope) ||
    right.importance - left.importance ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
}

/** Lower rank renders earlier; workspace rules are the most specific, so last. */
function directiveScopeRank(scope: MemoryRecord['scope']): number {
  return scope === 'workspace' ? 1 : 0
}
