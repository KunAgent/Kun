import type { LoopHookContext } from '../../seam/types.js'
import type { ExpertService } from '../services/expert-service.js'
import { ConversationExecutionProfileSchema } from '../../contracts/threads.js'
import { createHash } from 'node:crypto'

/**
 * Expert context hook - injects expert systemPrompt into agent loop
 *
 * When a thread has expertId set, this hook reads the expert's roleDefinition
 * and injects it as systemPrompt into the loop context. This enables expert
 * persona to be applied to the conversation.
 *
 * Stage 2: Thread Schema Extension + Expert Context Hook
 */

export interface ExpertContextHookOptions {
  expertService: ExpertService
}

/**
 * Creates a loop hook that injects expert systemPrompt based on thread.expertId
 */
export function createExpertContextHook(options: ExpertContextHookOptions) {
  const { expertService } = options

  return async (ctx: LoopHookContext): Promise<void> => {
    const profileResult = ConversationExecutionProfileSchema.safeParse(ctx.executionProfile)
    if (profileResult.success && profileResult.data.kind === 'expert') {
      const digest = `sha256:${createHash('sha256')
        .update(JSON.stringify(profileResult.data.snapshot))
        .digest('hex')}`
      if (digest !== profileResult.data.digest) {
        console.warn('[expert-context-hook] Expert rule snapshot digest mismatch')
        return
      }
      const snapshot = profileResult.data.snapshot
      const currentSystemPrompt = typeof ctx.systemPrompt === 'string' ? ctx.systemPrompt.trim() : ''
      ctx.systemPrompt = [
        currentSystemPrompt,
        snapshot.roleDefinition,
        snapshot.behaviorRules,
        snapshot.outputPreferences
      ].filter(Boolean).join('\n\n')
      ctx.expertDisplayName = snapshot.displayName
      return
    }

    // Read expertId from context (set by agent-loop from thread.expertId)
    const expertId = ctx.expertId as string | undefined

    if (!expertId) {
      // No expert selected, skip injection
      return
    }

    // Retrieve expert profile
    const expert = expertService.getExpert(expertId)

    if (!expert) {
      // Expert not found (may have been deleted or disabled)
      console.warn(`[expert-context-hook] Expert not found: ${expertId}`)
      return
    }

    if (!expert.enabled) {
      // Expert is disabled
      console.warn(`[expert-context-hook] Expert is disabled: ${expertId}`)
      return
    }

    // Inject expert roleDefinition as a request-scoped persona overlay.
    const currentSystemPrompt = typeof ctx.systemPrompt === 'string' ? ctx.systemPrompt.trim() : ''
    ctx.systemPrompt = [currentSystemPrompt, expert.roleDefinition.trim()]
      .filter(Boolean)
      .join('\n\n')

    // Optional: inject expert metadata for debugging/logging
    ctx.expertDisplayName = expert.displayName
    ctx.expertProfession = expert.profession
  }
}
