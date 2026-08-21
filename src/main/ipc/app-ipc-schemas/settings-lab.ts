import { z } from 'zod'

/**
 * Lab (experimental) settings patch accepted by the settings:set IPC.
 * Mirrors `KunLabSettingsPatchV1`: nested fields merge; a half-configured
 * model override is normalized away by the shared merge.
 */
export const kunLabPatchSchema = z.preprocess(
  (input) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const obj = input as Record<string, unknown>
      if (obj.exploreAgent !== undefined) {
        const { exploreAgent, ...rest } = obj
        return rest.fastContext === undefined ? { ...rest, fastContext: exploreAgent } : rest
      }
    }
    return input
  },
  z.object({
    fastContext: z.object({
      enabled: z.boolean().optional(),
      model: z.string().trim().max(256).optional(),
      providerId: z.string().trim().max(128).optional(),
      reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional(),
      fast: z.boolean().optional()
    }).strict().optional(),
    pptAgent: z.object({
      enabled: z.boolean().optional(),
      model: z.string().trim().max(256).optional(),
      providerId: z.string().trim().max(128).optional(),
      reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional(),
      fast: z.boolean().optional(),
      imageFirst: z.boolean().optional()
    }).strict().optional(),
    conversationVisualization: z.object({
      enabled: z.boolean().optional()
    }).strict().optional()
  }).strict()
)
