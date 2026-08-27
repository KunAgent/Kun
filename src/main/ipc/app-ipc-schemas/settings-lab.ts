import { z } from 'zod'

export const kunFastContextPatchSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().trim().max(256).optional(),
  providerId: z.string().trim().max(128).optional(),
  reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional(),
  fast: z.boolean().optional()
}).strict()

/** Lab (experimental) settings patch accepted by the settings:set IPC. */
export const kunLabPatchSchema = z.object({
  pptAgent: kunFastContextPatchSchema.extend({
    imageFirst: z.boolean().optional()
  }).strict().optional(),
  conversationVisualization: z.object({
    enabled: z.boolean().optional()
  }).strict().optional()
}).strict()
