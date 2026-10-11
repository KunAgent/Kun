import { z } from 'zod'

/** Host-frozen explicit capability constraints inherited across a task handoff. */
export const WorkbenchCapabilityCeilingSchema = z.object({
  allowedToolNames: z.array(z.string()).optional(),
  allowedProviderIds: z.array(z.string()).optional(),
  allowedSkillIds: z.array(z.string()).optional(),
  allowedReadPaths: z.array(z.string()).optional(),
  allowedWritePaths: z.array(z.string()).optional(),
  blockedToolNames: z.array(z.string()).default([]),
  blockedProviderIds: z.array(z.string()).default([]),
  blockedSkillIds: z.array(z.string()).default([]),
  skillsEnabled: z.boolean().optional()
}).strict()
export type WorkbenchCapabilityCeiling = z.infer<typeof WorkbenchCapabilityCeilingSchema>

export function hasWorkbenchCapabilityConstraints(value?: WorkbenchCapabilityCeiling): boolean {
  return Boolean(value && (value.allowedToolNames !== undefined || value.allowedProviderIds !== undefined ||
    value.allowedSkillIds !== undefined || value.allowedReadPaths !== undefined || value.allowedWritePaths !== undefined ||
    value.blockedToolNames.length || value.blockedProviderIds.length || value.blockedSkillIds.length || value.skillsEnabled === false))
}

/**
 * Host-written provenance for a Code or Work thread that a bot Agent started
 * on the user's behalf. Never accepted from a public thread request; it only
 * marks the thread so the sidebar can say where it came from.
 */
export const ThreadWorkbenchOriginSchema = z.object({
  kind: z.literal('bot'),
  roomId: z.string().min(1).max(128),
  linkId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(128),
  agentName: z.string().max(120).default(''),
  /** Card message in the bot conversation that tracks this task. */
  messageId: z.string().min(1).max(256).optional(),
  capabilityCeiling: WorkbenchCapabilityCeilingSchema.optional()
}).strict()
export type ThreadWorkbenchOrigin = z.infer<typeof ThreadWorkbenchOriginSchema>
