import { z } from 'zod'

/**
 * Native Agents an external harness lets the user switch between, for
 * example OpenCode's primary agents (build, plan and user-defined ones).
 * OpenCode publishes them as ACP session modes; Kun forwards the id the user
 * picked for a turn through `session/set_mode`.
 */
export const HarnessNativeAgentIdSchema = z.string().trim().min(1).max(128)

export const HarnessNativeAgentSchema = z
  .object({
    id: HarnessNativeAgentIdSchema,
    name: z.string().max(256).optional(),
    description: z.string().max(1_024).optional()
  })
  .strict()
export type HarnessNativeAgent = z.infer<typeof HarnessNativeAgentSchema>

export const HarnessNativeAgentListSchema = z.array(HarnessNativeAgentSchema).max(64)

/** Normalize ACP `modes.availableModes` into the native Agent list. */
export function nativeAgentsFromAcpModes(modes: unknown): HarnessNativeAgent[] {
  const available = modes && typeof modes === 'object'
    ? (modes as { availableModes?: unknown }).availableModes : undefined
  if (!Array.isArray(available)) return []
  const agents: HarnessNativeAgent[] = []
  for (const raw of available) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id || id.length > 128 || agents.some((agent) => agent.id === id)) continue
    agents.push({ id,
      ...(typeof entry.name === 'string' && entry.name.trim() ? { name: entry.name.trim().slice(0, 256) } : {}),
      ...(typeof entry.description === 'string' && entry.description.trim()
        ? { description: entry.description.trim().slice(0, 1_024) } : {}) })
    if (agents.length >= 64) break
  }
  return agents
}
