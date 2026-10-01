import { z } from 'zod'

const Id = z.string().min(1).max(256)
const Time = z.string().datetime({ offset: true })
export const AgentArtifactVersionSchema = z.object({
  schemaVersion: z.literal(1), id: Id, artifactId: Id, version: z.number().int().positive(),
  participantAgentId: Id, roomId: Id, workspaceId: Id, relativePath: z.string().min(1).max(4096),
  title: z.string().min(1).max(300), sourceRunId: Id, sourceMessageId: Id.optional(),
  blobId: z.string().regex(/^art_[0-9a-f]{1,64}$/),
  blobIds: z.array(z.string().regex(/^art_[0-9a-f]{1,64}$/)).min(1).max(20).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(), mimeType: z.string().min(1).max(200),
  encoding: z.literal('base64'), status: z.literal('version'), createdAt: Time
}).strict()
export type AgentArtifactVersion = z.infer<typeof AgentArtifactVersionSchema>
export const AgentArtifactSchema = AgentArtifactVersionSchema.omit({ id: true, status: true }).extend({
  id: Id, status: z.enum(['active', 'archived']), updatedAt: Time,
  /** Archived items remain retrievable; archive is a reversible retention choice. */
  retention: z.literal('keep'), archivedAt: Time.optional()
}).strict()
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>
export const AgentArtifactQuery = z.object({ search: z.string().trim().max(200).optional(),
  cursor: z.coerce.number().int().nonnegative().optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
  archived: z.enum(['true', 'false']).optional() }).strict()
export const AgentArtifactVersionQuery = z.object({ cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30) }).strict()
