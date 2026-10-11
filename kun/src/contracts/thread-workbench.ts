import { z } from 'zod'

/** Host-written identity for a managed worker side thread. */
export const ThreadExecutionUnitSchema = z.object({
  kind: z.literal('worker'),
  teamId: z.string().min(1),
  managerThreadId: z.string().min(1),
  label: z.string().min(1).max(64),
  role: z.string().max(64).optional(),
  lifecycle: z.enum(['persistent', 'ephemeral']),
  taskWorkspaceId: z.string().min(1).optional(),
  control: z.enum(['manager', 'user'])
}).strict()
export type ThreadExecutionUnit = z.infer<typeof ThreadExecutionUnitSchema>

export const DesignCloneOperationSchema = z.object({
  operationId: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  kind: z.enum(['fork', 'resume']),
  sourceId: z.string().trim().min(1).max(256)
}).strict()
export type DesignCloneOperation = z.infer<typeof DesignCloneOperationSchema>

/** Thread-owned admission policy for persistent ADE teams. */
export const ThreadCollaborationSchema = z.object({
  enabled: z.boolean(),
  /** Host-maintained marker retaining controls for work already admitted. */
  everEnabled: z.boolean().optional()
}).strict()
export type ThreadCollaboration = z.infer<typeof ThreadCollaborationSchema>
export const ThreadCollaborationRequestSchema = ThreadCollaborationSchema.pick({ enabled: true })
