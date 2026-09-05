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
  }).strict().optional(),
  autoPlanBuild: z.object({
    enabled: z.boolean().optional(),
    confirmation: z.enum(['always', 'defaults']).optional(),
    defaultBuildMode: z.enum(['direct', 'scheduled']).optional(),
    useWorktreeByDefault: z.boolean().optional(),
    scheduledDefaults: z.object({
      providerId: z.string().trim().max(128).optional(),
      model: z.string().trim().max(256).optional(),
      reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional(),
      timeZone: z.string().trim().max(128).optional()
    }).strict().optional()
  }).strict().optional(),
  projectBoard: z.object({
    enabled: z.boolean().optional()
  }).strict().optional()
}).strict()
