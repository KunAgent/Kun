import { z } from 'zod'

const IpcErrorDetailValue = z.union([z.string().max(2048), z.number().finite(), z.boolean()])

/**
 * Cross-process error payload. The envelope intentionally excludes stacks and
 * arbitrary objects so main-process internals cannot leak through IPC.
 */
export const AppIpcErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2048),
  retryable: z.boolean(),
  incidentId: z.string().min(1).max(128).optional(),
  details: z.record(z.string().min(1).max(128), IpcErrorDetailValue)
    .refine((value) => Object.keys(value).length <= 32, 'Too many error detail fields.')
    .optional()
}).strict()

export type AppIpcError = z.infer<typeof AppIpcErrorSchema>
