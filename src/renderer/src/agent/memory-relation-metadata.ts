import { MemoryRelationAnnotation, MEMORY_CONTEXT_MAX_RELATIONS } from '@shared/memory-working-context'

export function parseMemoryRelationMetadata(value: unknown): MemoryRelationAnnotation[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MEMORY_CONTEXT_MAX_RELATIONS)
    .map((entry) => MemoryRelationAnnotation.safeParse(entry))
    .filter((entry) => entry.success)
    .map((entry) => entry.data)
}
