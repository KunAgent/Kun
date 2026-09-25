import type { MemoryRecord } from '../contracts/memory.js'
import type { KunTurnContextBlock } from '../prompt/kun-prompt-context.js'
import { memoryPreview } from '../shared/memory-preview.js'
import { kunContextBlock } from './model-step-preparation-helpers.js'
import {
  memoryDirectiveInstructions,
  memoryInstructions
} from './memory-instructions.js'

/**
 * Order matters: the user-authority directive block renders before the
 * untrusted reference block. The reference block keeps authority='reference'
 * so its contents stay evidence instead of inheriting user authority.
 */
export function memoryContextBlocks(input: {
  directives: readonly MemoryRecord[]
  memories: readonly MemoryRecord[]
}, nowMs = Date.now()): KunTurnContextBlock[] {
  return [
    ...memoryDirectiveInstructions(input.directives)
      .map((content) => kunContextBlock('memory-directives', 'user', content)),
    ...memoryInstructions(input.memories, nowMs)
      .map((content) => kunContextBlock('memory', 'reference', content))
  ]
}

/** Turn metadata recorded per step so the GUI can show what was injected. */
export function memoryInjectionMetadata(input: {
  memories: readonly MemoryRecord[]
  directives: readonly MemoryRecord[]
}): {
  injectedMemoryIds: string[]
  injectedMemorySummaries: { id: string; content: string }[]
  injectedDirectiveIds: string[]
  injectedDirectiveSummaries: { id: string; content: string }[]
} {
  return {
    injectedMemoryIds: input.memories.map((memory) => memory.id),
    injectedMemorySummaries: input.memories.map((memory) => ({
      id: memory.id,
      content: memoryPreview(memory.content)
    })),
    injectedDirectiveIds: input.directives.map((memory) => memory.id),
    injectedDirectiveSummaries: input.directives.map((memory) => ({
      id: memory.id,
      content: memoryPreview(memory.content)
    }))
  }
}
