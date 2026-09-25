import type { MemoryRecord } from '../contracts/memory.js'
import { formatMemoryReferenceBlock } from './memory-context-format.js'
import { formatMemoryDirectiveBlock } from './memory-directive-format.js'
import { DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT } from './memory-retrieval.js'
import type { MemoryAccess, MemoryDirectiveResult } from './memory-store.js'

/**
 * Minimal store surface every turn path (native loop, Agent SDK, Cursor SDK)
 * shares so memory selection and rendering cannot drift apart.
 */
export type MemoryTurnStore = {
  retrieve(input: {
    query: string
    workspace: string
    limit: number
  }): Promise<MemoryRecord[]>
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
  input: { query: string; workspace: string },
  nowMs = Date.now()
): Promise<MemoryTurnContext> {
  if (!store) return EMPTY_MEMORY_TURN_CONTEXT
  const [memories, directiveResult] = await Promise.all([
    store.retrieve({
      query: input.query,
      workspace: input.workspace,
      limit: DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT
    }),
    store.listDirectives
      ? store.listDirectives({ workspace: input.workspace })
      : Promise.resolve(undefined)
  ])
  store.setLastInjected(memories.map((memory) => memory.id))
  const directives = directiveResult?.records ?? []
  const directiveBlock = formatMemoryDirectiveBlock(directives)
  const referenceBlock = formatMemoryReferenceBlock(memories, nowMs)
  return {
    memories,
    directives,
    directiveBlocks: directiveBlock ? [directiveBlock] : [],
    referenceBlocks: referenceBlock ? [referenceBlock] : []
  }
}
