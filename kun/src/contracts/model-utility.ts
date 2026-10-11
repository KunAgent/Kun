import { z } from 'zod'

export const ModelUtilityRequestSchema = z.object({
  purpose: z.enum(['write-inline', 'schedule-detection', 'prompt-optimization', 'paper-translation', 'provider-test']),
  providerId: z.string().min(1).max(128), model: z.string().min(1).max(512),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(512 * 1024) }).strict()).min(1).max(64),
  fim: z.object({ prompt: z.string().max(512 * 1024), suffix: z.string().max(256 * 1024) }).strict().optional(),
  maxOutputTokens: z.number().int().min(1).max(64_000).default(1600),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  jsonMode: z.boolean().default(false), temperature: z.number().min(0).max(2).optional()
}).strict()
export type ModelUtilityRequest = z.input<typeof ModelUtilityRequestSchema>
export type ModelUtilityResult = { ok: true; text: string } | { ok: false; message: string }
