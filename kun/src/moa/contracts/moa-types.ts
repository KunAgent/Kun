import { z } from 'zod'

/**
 * MoA (Mixture of Agents) Domain Contracts
 *
 * Based on latest research (2025-2026):
 * - Together AI foundational paper (arXiv:2406.04692)
 * - Attention-MoA (2026) - inter-agent semantic attention
 * - MMoA (2026) - memoried routing with LSTM gating
 * - Pyramid MoA (2026) - adaptive routing
 *
 * Key improvements over basic MoA:
 * - Dynamic routing (avoid unnecessary multi-model calls)
 * - Proposer quality + diversity optimization
 * - Parallel execution with graceful degradation
 * - Token-level streaming support
 */

/**
 * MoA layer configuration
 */
export const MoaLayerSchema = z.object({
  /** Layer type: 'proposer' generates diverse responses, 'aggregator' synthesizes */
  type: z.enum(['proposer', 'aggregator']),
  /** Model references for this layer (proposers run in parallel) */
  models: z.array(z.string().min(1)).min(1).max(10),
  /** Optional role descriptions for proposer specialization (SMoA technique) */
  roleDescriptions: z.array(z.string()).optional(),
  /** Temperature override for this layer (default: use model's default) */
  temperature: z.number().min(0).max(2).optional(),
  /** Max tokens override for this layer */
  maxTokens: z.number().int().positive().optional()
})
export type MoaLayer = z.infer<typeof MoaLayerSchema>

/**
 * MoA preset - defines a complete multi-layer architecture
 */
export const MoaPresetSchema = z
  .object({
    /** Unique preset identifier */
    id: z.string().min(1).max(50),
    /** Display name */
    name: z.string().min(1).max(100),
    /** Description of this preset's purpose/strengths */
    description: z.string().max(500),
    /** Ordered layers (typically 1 proposer layer + 1 aggregator layer) */
    layers: z.array(MoaLayerSchema).min(1).max(5),
    /** Whether to enable dynamic routing (Pyramid MoA) - skip multi-model for simple queries */
    dynamicRouting: z.boolean().default(false),
    /** Router model for dynamic routing (lightweight model to decide if MoA is needed) */
    routerModel: z.string().optional(),
    /** Cost multiplier estimate (number of model calls relative to single model) */
    costMultiplier: z.number().positive(),
    /** Enabled flag */
    enabled: z.boolean().default(true),
    /** Total context budget shared by original context and injected references. */
    contextBudgetTokens: z.number().int().positive().optional(),
    /** Declared virtual-model input support for catalog and modality planning. */
    inputModalities: z.array(z.enum(['text', 'image', 'video'])).min(1).optional(),
    /** Per-preset cap for concurrent reference requests. */
    maxConcurrency: z.number().int().min(1).max(10).optional()
  })
  .strict()
export type MoaPreset = z.infer<typeof MoaPresetSchema>

/**
 * Model reference format: "providerId/modelId" or just "modelId" for default provider
 */
export const MoaModelReferenceSchema = z
  .string()
  .min(1)
  .refine(
    (ref) => {
      // Format: "providerId/modelId" or "modelId"
      const parts = ref.split('/')
      return parts.length <= 2 && parts.every((p) => p.length > 0)
    },
    { message: 'Model reference must be "modelId" or "providerId/modelId"' }
  )
export type MoaModelReference = z.infer<typeof MoaModelReferenceSchema>

/**
 * MoA execution trace - records how a MoA request was processed
 */
export const MoaTraceSchema = z.object({
  /** Trace ID */
  traceId: z.string().min(1),
  /** Preset used */
  presetId: z.string().min(1),
  /** Whether dynamic routing was used */
  usedDynamicRouting: z.boolean(),
  /** Router decision (if dynamic routing enabled) */
  routerDecision: z.enum(['skip_moa', 'use_moa']).optional(),
  /** Layers executed */
  layers: z.array(
    z.object({
      type: z.enum(['proposer', 'aggregator']),
      models: z.array(z.string()),
      /** Execution time in milliseconds */
      durationMs: z.number().int().nonnegative(),
      /** Token counts per model */
      tokenCounts: z.record(z.string(), z.object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative()
      }))
    })
  ),
  /** Total execution time */
  totalDurationMs: z.number().int().nonnegative(),
  /** Total tokens used across all models */
  totalTokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative()
  })
})
export type MoaTrace = z.infer<typeof MoaTraceSchema>

/**
 * MoA configuration (from config.extensions.moa)
 */
export const MoaConfigSchema = z
  .object({
    /** Available MoA presets */
    presets: z.array(MoaPresetSchema).default([]),
    /** Default preset ID to use */
    defaultPresetId: z.string().optional(),
    /** Whether to enable MoA tracing (performance/cost debugging) */
    enableTracing: z.boolean().default(false),
    /** Max concurrent proposer calls per layer (to limit resource usage) */
    maxConcurrentProposers: z.number().int().positive().default(4)
  })
  .strict()
export type MoaConfig = z.infer<typeof MoaConfigSchema>

/**
 * Built-in MoA presets.
 *
 * Model references use the "providerId/modelId" form so requests route to the
 * intended provider. The default-enabled preset intentionally references the
 * runtime's default provider (bare modelId) with the same model sampled at
 * different temperatures/roles — a self-MoA that works with any single
 * provider (including DeepSeek) with no extra credentials. Cross-provider
 * presets are disabled by default and must be enabled after the referenced
 * providers/accounts are configured; MoaConfigAdapter.validateProviders()
 * disables any preset whose references point at an unconfigured provider.
 */
export const BUILTIN_MOA_PRESETS: MoaPreset[] = [
  {
    id: 'balanced-local',
    name: 'Balanced (Self-MoA, default provider)',
    description: 'Single-provider MoA: 3 diverse samples from the runtime default model + 1 aggregator pass. No extra credentials required.',
    layers: [
      {
        type: 'proposer',
        models: ['deepseek-v4-pro', 'deepseek-v4-pro', 'deepseek-v4-pro'],
        roleDescriptions: [
          'Provide a detailed, analytical response',
          'Provide a concise, practical response',
          'Provide a creative, exploratory response'
        ],
        temperature: 0.7
      },
      {
        type: 'aggregator',
        models: ['deepseek-v4-pro'],
        temperature: 0.3
      }
    ],
    dynamicRouting: false,
    costMultiplier: 4,
    enabled: true
  },
  {
    id: 'quality-3-proposer',
    name: 'Quality (3 Proposers, cross-provider)',
    description: 'Balanced quality/cost - 3 diverse proposers + 1 aggregator. Requires anthropic/openai/google providers configured.',
    layers: [
      {
        type: 'proposer',
        models: ['anthropic/claude-3-5-sonnet-20241022', 'openai/gpt-4o', 'google/gemini-2.0-flash-exp'],
        roleDescriptions: [
          'Provide a detailed, analytical response',
          'Provide a concise, practical response',
          'Provide a creative, exploratory response'
        ]
      },
      {
        type: 'aggregator',
        models: ['anthropic/claude-3-5-sonnet-20241022']
      }
    ],
    dynamicRouting: false,
    costMultiplier: 4,
    enabled: false // Disabled until cross-provider credentials are configured
  },
  {
    id: 'fast-2-proposer',
    name: 'Fast (2 Proposers, cross-provider)',
    description: 'Cost-optimized - 2 fast proposers + 1 aggregator. Requires anthropic/openai providers configured.',
    layers: [
      {
        type: 'proposer',
        models: ['anthropic/claude-3-5-haiku-20241022', 'openai/gpt-4o-mini']
      },
      {
        type: 'aggregator',
        models: ['anthropic/claude-3-5-sonnet-20241022']
      }
    ],
    dynamicRouting: false,
    costMultiplier: 3,
    enabled: false // Disabled until cross-provider credentials are configured
  },
  {
    id: 'research-6-proposer',
    name: 'Research (6 Proposers, cross-provider)',
    description: 'Maximum quality - 6 diverse proposers + strong aggregator. Expensive; requires many providers configured.',
    layers: [
      {
        type: 'proposer',
        models: [
          'anthropic/claude-3-5-sonnet-20241022',
          'openai/gpt-4o',
          'google/gemini-2.0-flash-exp',
          'deepseek/deepseek-chat',
          'qwen/qwen-max',
          'groq/llama-3.1-70b-versatile'
        ]
      },
      {
        type: 'aggregator',
        models: ['anthropic/claude-opus-4-20250514']
      }
    ],
    dynamicRouting: false,
    costMultiplier: 7,
    enabled: false // Disabled by default due to high cost + cross-provider deps
  }
]
