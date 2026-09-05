import type { MemoryRecord } from '../contracts/memory.js'
import { formatMemoryReferenceBlock } from '../memory/memory-context-format.js'

export function memoryInstructions(memories: readonly MemoryRecord[], nowMs = Date.now()): string[] {
  if (memories.length === 0) return []
  return [formatMemoryReferenceBlock(memories, nowMs)]
}
