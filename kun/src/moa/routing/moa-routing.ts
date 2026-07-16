import type { LoopHookContext } from '../../seam/types.js'
import type { MoaConfigAdapter } from '../adapters/moa-config.js'

/**
 * MoA Routing Hook
 *
 * Decides whether to route a request to MoA or use a normal single model.
 * Implements dynamic routing (Pyramid MoA technique) - skip expensive multi-model
 * calls for simple queries that don't benefit from aggregation.
 *
 * Fires on 'beforeModelRequest' so its providerId/model overrides land on the
 * actual ModelRequest built by ModelStepService.
 */

export interface MoaRoutingHookOptions {
  configAdapter: MoaConfigAdapter
}

export function createMoaRoutingHook(options: MoaRoutingHookOptions) {
  const { configAdapter } = options

  return async (ctx: LoopHookContext): Promise<void> => {
    // Read thread's MoA preference from context (set by ModelStepService from
    // thread.moaPresetId).
    const moaPresetId = ctx.moaPresetId as string | undefined

    if (!moaPresetId) {
      // No MoA configured for this thread, skip routing
      return
    }

    // Get preset
    const preset = configAdapter.getPreset(moaPresetId)
    if (!preset) {
      console.warn(`[MoA] Preset not found or disabled: ${moaPresetId}`)
      return
    }

    // Optional dynamic routing (Pyramid MoA): decide up front whether this
    // query is complex enough to benefit from multi-model aggregation. When it
    // is not, fall back to a single proposer model and skip MoA entirely.
    if (preset.dynamicRouting) {
      const shouldUseMoa = evaluateRouterDecision(ctx)
      if (!shouldUseMoa) {
        const fallbackModel = preset.layers[0]?.models[0]
        if (fallbackModel) {
          const { providerId, modelId } = configAdapter.parseModelReference(fallbackModel)
          if (providerId) ctx.providerId = providerId
          ctx.model = modelId
          return
        }
      }
    }

    // Route through the single MoA dispatcher: providerId='moa',
    // model='moa-{presetId}'. The dispatcher resolves the preset at stream time.
    ctx.providerId = 'moa'
    ctx.model = `moa:${preset.id}`
  }
}

/**
 * Heuristic router decision for dynamic routing.
 *
 * A lightweight, deterministic classifier that decides whether a query is
 * complex enough to justify multi-model aggregation. It inspects the latest
 * user prompt carried on the hook context (when available). Short, single-line,
 * factual-looking prompts skip MoA; longer or multi-part prompts use it.
 *
 * This intentionally avoids a network round-trip: a router model call would
 * add latency and cost to every turn. Callers that want model-based routing
 * can override `ctx.moaRouterDecision` before this hook runs.
 */
function evaluateRouterDecision(ctx: LoopHookContext): boolean {
  const override = ctx.moaRouterDecision
  if (override === 'use_moa') return true
  if (override === 'skip_moa') return false

  const prompt = typeof ctx.latestPrompt === 'string' ? ctx.latestPrompt.trim() : ''
  if (!prompt) return true // No signal — default to MoA (safer for quality).

  const wordCount = prompt.split(/\s+/).length
  const hasMultipleSentences = /[.!?].+[.!?]/.test(prompt)
  const looksComplex = wordCount >= 25 || hasMultipleSentences || prompt.includes('\n')
  return looksComplex
}
