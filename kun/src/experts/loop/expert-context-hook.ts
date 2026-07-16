import type { LoopHookContext } from '../../seam/types.js'
import type { ExpertService } from '../services/expert-service.js'

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

    // Inject expert roleDefinition as systemPrompt
    // The agent loop will read ctx.systemPrompt and apply it to the model request
    ctx.systemPrompt = expert.roleDefinition

    // Optional: inject expert metadata for debugging/logging
    ctx.expertDisplayName = expert.displayName
    ctx.expertProfession = expert.profession
  }
}
