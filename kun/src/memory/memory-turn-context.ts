import { resolveMemoryProjectAccess } from './memory-project-identity.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { formatMemoryReferenceBlock } from './memory-context-format.js'
import { formatMemoryDirectiveBlock } from './memory-directive-format.js'
import { DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT } from './memory-retrieval.js'
import type { MemoryAccess, MemoryDirectiveResult } from './memory-store.js'
import {
  emptyMemoryRelationContext, MemoryRelationContextResult, type MemoryRelationContextRequest
} from '../contracts/memory-working-context.js'
import { DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET } from './memory-retrieval-trace.js'
import { MEMORY_RELATION_MAX_RECORD_CHARS } from '../contracts/memory-relations.js'

/**
 * Minimal store surface every turn path (native loop, Agent SDK, Cursor SDK)
 * shares so memory selection and rendering cannot drift apart.
 */
export type MemoryTurnStore = {
  retrieve(input: {
    query: string
    workspace: string
    projectIdentity?: string
    limit: number
    purpose?: 'injection' | 'preview'
  }): Promise<MemoryRecord[]>
  relationContext?(request: MemoryRelationContextRequest): Promise<MemoryRelationContextResult>
  setLastInjected(ids: string[]): void
  listDirectives?(access?: MemoryAccess): Promise<MemoryDirectiveResult>
}

export type MemoryTurnContext = Readonly<{
  /** Relevance-gated reference evidence for this turn. */
  memories: MemoryRecord[]
  /** User-approved standing rules injected every turn, budget permitting. */
  directives: MemoryRecord[]
  /** Rendered directive block(s); empty when no directives were injected. */
  directiveBlocks: string[]
  /** Rendered untrusted reference-evidence block(s). */
  referenceBlocks: string[]
  relationContext?: MemoryRelationContextResult
}>

const EMPTY_MEMORY_TURN_CONTEXT: MemoryTurnContext = {
  memories: [],
  directives: [],
  directiveBlocks: [],
  referenceBlocks: []
}

/**
 * Directives are fetched without a relevance gate so they are injected even on
 * empty or unrelated prompts; reference memories keep the relevance filter.
 */
export async function resolveMemoryTurnContext(
  store: MemoryTurnStore | undefined,
  input: { query: string; workspace: string; preview?: boolean },
  nowMs = Date.now()
): Promise<MemoryTurnContext> {
  if (!store) return EMPTY_MEMORY_TURN_CONTEXT
  const access = await resolveMemoryProjectAccess({ workspace: input.workspace })
  const [memories, directiveResult] = await Promise.all([
    store.retrieve({
      query: input.query,
      ...access,
      limit: DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT,
      ...(input.preview ? { purpose: 'preview' as const } : {})
    }),
    store.listDirectives && !input.preview
      ? store.listDirectives(access)
      : Promise.resolve(undefined)
  ])
  if (!input.preview) store.setLastInjected(memories.map((memory) => memory.id))
  const directives = directiveResult?.records ?? []
  const directiveBlock = formatMemoryDirectiveBlock(directives)
  const referenceBlock = formatMemoryReferenceBlock(memories, nowMs)
  const relationContext = await resolveRelations(store, memories, {
    workspace: access.workspace
  }, referenceBlock.length, input.preview === true)
  return {
    memories,
    directives,
    directiveBlocks: directiveBlock ? [directiveBlock] : [],
    referenceBlocks: [referenceBlock, relationContext.block].filter(Boolean),
    relationContext
  }
}

async function resolveRelations(
  store: MemoryTurnStore, memories: MemoryRecord[], access: MemoryRelationContextRequest['access'],
  usedCharacters: number, preview: boolean
): Promise<MemoryRelationContextResult> {
  if (!store.relationContext) return emptyMemoryRelationContext('unavailable')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    // Optional, read-only enrichment must not hold up an otherwise valid turn.
    // The finite Manager/ledger read may finish later, but its result is ignored.
    return MemoryRelationContextResult.parse(await Promise.race([
      store.relationContext({
        selected: memories.filter((record) => record.content.length <= MEMORY_RELATION_MAX_RECORD_CHARS)
          .map(({ id, revision, content }) => ({ id, revision, content })),
        access, purpose: preview ? 'preview' : 'injection',
        remainingCharacters: Math.max(0, DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET - usedCharacters - 1)
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Relation context deadline')), 1000) })
    ]))
  } catch {
    return emptyMemoryRelationContext('unavailable')
  } finally {
    clearTimeout(timeout)
  }
}
