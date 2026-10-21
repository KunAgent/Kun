import { z } from 'zod'
import { MAX_ID_LENGTH, MAX_PATH_LENGTH, trimmedString } from './common'

/** A turn range rarely touches more than a few dozen files; the cap is defensive. */
const MAX_TURN_UNDO_FILES = 2_000

const checkpointIdSchema = trimmedString(MAX_ID_LENGTH * 4)

const turnUndoTargetShape = {
  checkpointId: checkpointIdSchema,
  expectedThreadId: trimmedString(MAX_ID_LENGTH).optional(),
  expectedWorkspaceRoot: trimmedString(MAX_PATH_LENGTH).optional()
}

const turnUndoPreflightShape = {
  ...turnUndoTargetShape,
  files: z.array(z.object({
    path: trimmedString(MAX_PATH_LENGTH),
    afterSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable()
  }).strict()).max(MAX_TURN_UNDO_FILES),
  shellCommandsRan: z.boolean().optional(),
  windowEndCheckpointId: checkpointIdSchema.optional()
}

export const gitTurnUndoPreflightPayloadSchema = z.object(turnUndoPreflightShape).strict()

export const gitTurnUndoPayloadSchema = z.object({
  ...turnUndoPreflightShape,
  scope: z.enum(['turn', 'rewind']).optional()
}).strict()

export const gitTurnReapplyPayloadSchema = z.object({
  ...turnUndoTargetShape,
  undoId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const gitTurnUndoStatusPayloadSchema = z.object({ checkpointId: checkpointIdSchema }).strict()
