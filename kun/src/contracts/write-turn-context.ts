import { z } from 'zod'

const SHA256_HEX = /^[a-f0-9]{64}$/

/**
 * Durable, runtime-verifiable reference to the document a Write turn is bound
 * to. Unlike the renderer's private revision counters, `expectedSha256` is a
 * disk-byte fingerprint the runtime can recompute before promoting a queued
 * turn, so a stale Write send can fail in place instead of acting on an
 * out-of-date document after the GUI has closed.
 */
export const WriteTurnContextSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4096),
  /** Absolute or workspace-relative path to the active document. Null for whiteboard-only sends. */
  documentPath: z.string().trim().min(1).max(4096).nullable(),
  documentEpoch: z.number().int().nonnegative().optional(),
  contentRevision: z.number().int().nonnegative().optional(),
  whiteboardId: z.string().trim().min(1).max(256).optional(),
  whiteboardRevision: z.number().int().nonnegative().optional(),
  /** SHA-256 of the document bytes captured by the renderer after the final save. */
  expectedSha256: z.string().regex(SHA256_HEX).optional()
}).strict()

export type WriteTurnContext = z.infer<typeof WriteTurnContextSchema>
