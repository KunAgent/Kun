import type { MemoryRecord } from '../contracts/memory.js'
import { formatMemoryReferenceBlock } from '../memory/memory-context-format.js'
import { formatMemoryDirectiveBlock } from '../memory/memory-directive-format.js'

export function memoryInstructions(memories: readonly MemoryRecord[], nowMs = Date.now()): string[] {
  if (memories.length === 0) return []
  return [formatMemoryReferenceBlock(memories, nowMs)]
}

export function memoryDirectiveInstructions(directives: readonly MemoryRecord[]): string[] {
  if (directives.length === 0) return []
  return [formatMemoryDirectiveBlock(directives)]
}
