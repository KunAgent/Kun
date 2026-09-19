import { z } from 'zod'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import {
  parseArtifactId,
  type ManagerArtifactStoreOperation
} from './shared-data-store-contracts.js'

export async function executeArtifactStoreOperation(
  artifactStore: ArtifactStore,
  operation: ManagerArtifactStoreOperation,
  value: unknown
): Promise<unknown> {
  switch (operation) {
    case 'put': {
      const body = z.object({
        input: z.object({
          content: z.string(),
          mimeType: z.string().min(1).optional(),
          source: z.enum(['mcp', 'web', 'bash', 'attachment', 'remote-log', 'tool', 'other']).optional(),
          origin: z.string().min(1).optional(),
          linkedOwners: z.array(z.string().min(1).max(512)).max(64).optional(),
          maxInlineChars: z.number().int().nonnegative().optional()
        }).strict()
      }).strict().parse(value)
      return artifactStore.put(body.input)
    }
    case 'releaseOwner': {
      const body = z.object({
        ownerId: z.string().min(1).max(512)
      }).strict().parse(value)
      return artifactStore.releaseOwner?.(body.ownerId) ?? {
        released: 0,
        deleted: 0
      }
    }
    case 'delete': {
      const { id } = parseArtifactId(value)
      await artifactStore.delete?.(id)
      return null
    }
    case 'list':
      return artifactStore.list?.() ?? []
    case 'get':
      return artifactStore.get(parseArtifactId(value).id)
    case 'readRange': {
      const body = z.object({
        id: z.string().min(1).max(256),
        options: z.object({
          offset: z.number().int().nonnegative().optional(),
          length: z.number().int().nonnegative().optional(),
          startLine: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional()
        }).strict()
      }).strict().parse(value)
      return artifactStore.readRange(body.id, body.options)
    }
    case 'stat':
      return artifactStore.stat(parseArtifactId(value).id)
  }
}
