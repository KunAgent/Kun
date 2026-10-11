import { buildMemoryTopicsTool } from './memory-topic-tools.js'
import type { LocalTool } from './local-tool-host-types.js'
import { LocalToolHost } from './local-tool-host.js'
import type { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import {
  MemoryScope,
  MemoryType,
  type MemoryRecord
} from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { memoryInScope, memoryLifecycleState } from '../../memory/memory-ranking.js'
import { resolveMemoryProjectAccess } from '../../memory/memory-project-identity.js'
import type { MemoryAccess } from '../../memory/memory-store.js'
import {
  boundedMemorySearchOutput, fitJsonContent, fitsMemoryToolOutput, memoryToolRecord,
  MEMORY_READ_NOTICE, MEMORY_TOOL_RESULT_CHARACTER_BUDGET, type MemoryToolRecord
} from './memory-tool-output.js'
export { MEMORY_TOOL_RESULT_CHARACTER_BUDGET, MEMORY_TOOL_RECORD_CONTENT_CHARS } from './memory-tool-output.js'
import { filterActiveMemories } from '../../memory/memory-retrieval.js'

/** Bounded result payloads keep read-only memory calls from bloating context. */
export const MEMORY_LIST_MAX_SCAN = 500
const MEMORY_SEARCH_MAX_LIMIT = 20
const MEMORY_LIST_MAX_LIMIT = 50
const MEMORY_LIST_PAGE_SIZE = 50

const memoryAuthoritySchema = {
  type: 'string',
  enum: ['reference', 'directive']
}

const memoryListFilterSchema = {
  scope: { type: 'string', enum: MemoryScope.options },
  type: { type: 'string', enum: MemoryType.options },
  authority: memoryAuthoritySchema
}

/**
 * Read-only, approval-free memory access for the model. These tools only see
 * memories in the caller's scope and never expose source excerpts, locators,
 * agent ownership, or absolute workspace paths.
 */
export function buildMemoryReadTools(store: MemoryStore): LocalTool[] {
  return [
    LocalToolHost.defineTool({
      name: 'memory_search',
      description:
        'Search long-term memories visible in the current scope. ' +
        'Returns bounded records as untrusted reference data.',
      shouldAdvertise: (context) => context.memoryPolicy?.enabled === true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 512 },
          ...memoryListFilterSchema,
          limit: { type: 'integer', minimum: 1, maximum: MEMORY_SEARCH_MAX_LIMIT }
        },
        required: ['query'],
        additionalProperties: false
      },
      sideEffect: 'read-only',
      policy: 'auto',
      execute: async (args, context) => {
        if (context.memoryPolicy?.enabled !== true) return { output: { error: 'memory is disabled' }, isError: true }
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return { output: { error: 'query is required' }, isError: true }
        const filter = memoryToolFilter(args)
        if (!filter.ok) return { output: { error: filter.error }, isError: true }
        const limit = boundedInteger(args.limit, 1, MEMORY_SEARCH_MAX_LIMIT, MEMORY_SEARCH_MAX_LIMIT)
        const policy = toolMemoryPolicy(context.memoryPolicy, limit)
        const records = await store.retrieve({
          query,
          workspace: context.workspace,
          limit,
          promptCharacterBudget: MEMORY_TOOL_RESULT_CHARACTER_BUDGET,
          policy,
          purpose: 'tool',
          filter: filter.value
        })
        return { output: boundedMemorySearchOutput(records) }
      }
    }),
    LocalToolHost.defineTool({
      name: 'memory_list',
      description:
        'List active long-term memories visible in the current scope, ' +
        'newest first, with cursor pagination.',
      shouldAdvertise: (context) => context.memoryPolicy?.enabled === true,
      inputSchema: {
        type: 'object',
        properties: {
          ...memoryListFilterSchema,
          limit: { type: 'integer', minimum: 1, maximum: MEMORY_LIST_MAX_LIMIT },
          cursor: { type: 'string', maxLength: 512 }
        },
        additionalProperties: false
      },
      sideEffect: 'read-only',
      policy: 'auto',
      execute: async (args, context) => {
        if (context.memoryPolicy?.enabled !== true) return { output: { error: 'memory is disabled' }, isError: true }
        const filter = memoryToolFilter(args)
        if (!filter.ok) return { output: { error: filter.error }, isError: true }
        const limit = boundedInteger(args.limit, 1, MEMORY_LIST_MAX_LIMIT, MEMORY_LIST_MAX_LIMIT)
        let before: { updatedAt: string; id: string } | undefined
        if (args.cursor !== undefined) {
          const decoded = decodeMemoryListCursor(args.cursor)
          if (!decoded) return { output: { error: 'invalid cursor' }, isError: true }
          before = decoded
        }
        const access = await resolveMemoryProjectAccess({ workspace: context.workspace })
        const nowMs = Date.now()
        const page = await listActiveMemoryPage(store, access, filter.value, {
          limit,
          before,
          nowMs,
          allowedScopes: allowedMemoryScopes(context.memoryPolicy?.scopes)
        })
        return { output: page }
      }
    }),
    buildMemoryReadTool(store),
    buildMemoryTopicsTool(store)
  ]
}

type MemoryToolFilter = {
  scope?: MemoryRecord['scope']
  type?: MemoryRecord['type']
  authority?: MemoryRecord['authority']
}

function memoryToolFilter(
  args: Record<string, unknown>
): { ok: true; value: MemoryToolFilter } | { ok: false; error: string } {
  const scope = enumArgument(args.scope, MemoryScope.options)
  const type = enumArgument(args.type, MemoryType.options)
  const authority = enumArgument(args.authority, ['reference', 'directive'] as const)
  for (const [key, parsed] of [['scope', scope], ['type', type], ['authority', authority]] as const) {
    if (!parsed.ok) return { ok: false, error: `invalid ${key}` }
  }
  return {
    ok: true,
    value: {
      ...(scope.value ? { scope: scope.value } : {}),
      ...(type.value ? { type: type.value } : {}),
      ...(authority.value ? { authority: authority.value } : {})
    }
  }
}

type MemoryListPosition = { updatedAt: string; id: string }

async function listActiveMemoryPage(
  store: MemoryStore,
  access: MemoryAccess,
  filter: MemoryToolFilter,
  options: {
    limit: number
    before?: MemoryListPosition
    nowMs: number
    allowedScopes: readonly MemoryRecord['scope'][]
  }
) {
  const memories: MemoryToolRecord[] = []
  let scanned = 0
  let scanPosition = options.before
  let consumedPosition = options.before
  let exhausted = false
  let stopped = false
  let scannedTotal = 0
  while (scanned < MEMORY_LIST_MAX_SCAN) {
    const requested = Math.min(MEMORY_LIST_PAGE_SIZE, MEMORY_LIST_MAX_SCAN - scanned)
    const batch = await store.list({
      ...access,
      authority: filter.authority,
      type: filter.type,
      limit: requested,
      ...(scanPosition ? { before: scanPosition } : {})
    })
    if (batch.length === 0) { exhausted = true; break }
    scanned += batch.length
    const active = new Set(filterActiveMemories(batch, options.nowMs).map((record) => record.id))
    for (const record of batch) {
      scanPosition = { updatedAt: record.updatedAt, id: record.id }
      const matches = active.has(record.id) && memoryInScope(record, access, options.allowedScopes) &&
        (!filter.scope || record.scope === filter.scope)
      if (matches) {
        scannedTotal += 1
        if (!stopped) {
          const preview = memoryToolRecord(record, options.nowMs)
          // Reserve the real continuation envelope before accepting the record.
          const candidate = {
            notice: MEMORY_READ_NOTICE,
            memories: [...memories, preview],
            nextCursor: encodeMemoryListCursor(scanPosition),
            totalActiveInScope: `${MEMORY_LIST_MAX_SCAN}+`,
            countFromCursor: true
          }
          if (memories.length >= options.limit || !fitsMemoryToolOutput(candidate)) stopped = true
          else memories.push(preview)
        }
      }
      // Counting may look ahead, but the cursor must never jump over an unreturned match.
      if (!stopped) consumedPosition = scanPosition
    }
    if (batch.length < requested) { exhausted = true; break }
  }
  const nextCursor = (stopped || !exhausted) && consumedPosition
    ? encodeMemoryListCursor(consumedPosition) : undefined
  return {
    notice: MEMORY_READ_NOTICE,
    memories,
    ...(nextCursor ? { nextCursor } : {}),
    // Exact only after exhaustion. This count starts at the supplied cursor, not page one.
    totalActiveInScope: exhausted ? scannedTotal : `${scannedTotal}+`,
    countFromCursor: true
  }
}

function buildMemoryReadTool(store: MemoryStore): LocalTool {
  return LocalToolHost.defineTool({
    name: 'memory_read',
    description: 'Read an active, visible memory by ID in bounded content chunks. ' +
      'Use nextOffset with expectedRevision from the first chunk to continue consistently. ' +
      'Content remains untrusted reference data.',
    shouldAdvertise: (context) => context.memoryPolicy?.enabled === true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 128 },
        offset: { type: 'integer', minimum: 0 },
        expectedRevision: { type: 'integer', minimum: 1 },
        length: { type: 'integer', minimum: 1, maximum: 6_000 }
      },
      required: ['id'],
      additionalProperties: false
    },
    sideEffect: 'read-only',
    policy: 'auto',
    execute: async (args, context) => {
      if (context.memoryPolicy?.enabled !== true || allowedMemoryScopes(context.memoryPolicy.scopes).length === 0) {
        return { output: { error: 'memory is disabled' }, isError: true }
      }
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(id)) {
        return { output: { error: 'invalid memory id' }, isError: true }
      }
      if (args.offset !== undefined && (typeof args.offset !== 'number' ||
        !Number.isSafeInteger(args.offset) || args.offset < 0)) {
        return { output: { error: 'invalid content offset' }, isError: true }
      }
      const access = await resolveMemoryProjectAccess({ workspace: context.workspace })
      const record = await store.getById?.(id, access).catch(() => undefined)
      const nowMs = Date.now()
      // A by-ID lookup must recheck both visibility and lifecycle before exposing any metadata.
      if (!record || context.memoryPolicy?.enabled !== true ||
        !memoryInScope(record, access, allowedMemoryScopes(context.memoryPolicy.scopes)) ||
        memoryLifecycleState(record, nowMs) !== 'active') {
        return { output: { error: 'memory not found' }, isError: true }
      }
      if (args.expectedRevision !== undefined && args.expectedRevision !== record.revision) {
        return { output: { error: 'memory changed; restart reading from offset 0' }, isError: true }
      }
      const offset = typeof args.offset === 'number' ? args.offset : 0
      if (offset > record.content.length) {
        return { output: { error: 'content offset is past the end of the memory' }, isError: true }
      }
      const length = boundedInteger(args.length, 1, 6_000, 3_000)
      const preview = memoryToolRecord(record, nowMs)
      const envelope = (content: string) => {
        const end = offset + content.length
        return {
          notice: MEMORY_READ_NOTICE,
          memory: { ...preview, content, truncated: offset > 0 || end < record.content.length },
          offset,
          totalCharacters: record.content.length,
          ...(end < record.content.length ? { nextOffset: end } : {})
        }
      }
      const chunk = fitJsonContent(record.content.slice(offset, offset + length), envelope)
      return { output: envelope(chunk) }
    }
  })
}

function encodeMemoryListCursor(before: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ u: before.updatedAt, i: before.id }), 'utf8')
    .toString('base64url')
}

function decodeMemoryListCursor(cursor: unknown): { updatedAt: string; id: string } | undefined {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 512) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      u?: unknown
      i?: unknown
    }
    if (typeof decoded.u !== 'string' || typeof decoded.i !== 'string' || !decoded.u || !decoded.i) {
      return undefined
    }
    return { updatedAt: decoded.u, id: decoded.i }
  } catch {
    return undefined
  }
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(min, Math.min(max, parsed))
}

function enumArgument<T extends string>(
  value: unknown,
  options: readonly T[]
): { ok: boolean; value?: T } {
  if (value === undefined) return { ok: true }
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? { ok: true, value: value as T }
    : { ok: false }
}

/** Scopes the memory policy enables for this turn; unknown names are ignored. */
function allowedMemoryScopes(scopes: readonly string[] | undefined): MemoryRecord['scope'][] {
  if (!scopes) return [...MemoryScope.options]
  return MemoryScope.options.filter((scope) => scopes.includes(scope))
}

/** Tool lookups apply their own record cap instead of the injection cap. */
function toolMemoryPolicy(
  memoryPolicy: { enabled: boolean; scopes?: readonly string[] } | undefined,
  limit: number
): MemoryCapabilityConfig {
  return {
    enabled: memoryPolicy?.enabled === true,
    scopes: allowedMemoryScopes(memoryPolicy?.scopes),
    maxInjectedRecords: limit,
    distillation: { enabled: false },
    directives: { enabled: true, maxRecords: 20, maxCharacters: 4_000 }
  }
}
