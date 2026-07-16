import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { MoaPreset, MoaLayer, MoaTrace } from '../contracts/moa-types.js'
import type { MoaConfigAdapter } from './moa-config.js'
import { planMoaContext } from '../services/moa-context-planner.js'

/**
 * MoA Model Client
 *
 * Implements ModelClient interface to provide Mixture-of-Agents inference.
 * Based on latest research (2025-2026):
 * - Parallel proposer execution (minimize latency)
 * - Layered architecture (proposers → aggregator)
 * - Graceful degradation (fallback to single model on errors)
 * - Token-level streaming support
 *
 * Architecture:
 * 1. Layer 1 (Proposers): N models generate diverse responses in parallel
 * 2. Layer 2 (Aggregator): 1 model synthesizes proposer outputs into final answer
 *
 * The aggregator receives all proposer outputs as context via system prompt injection.
 */

export interface MoaModelClientOptions {
  /** MoA config adapter */
  configAdapter: MoaConfigAdapter
  /** Preset to use for this client instance */
  preset: MoaPreset
  /** Multi-provider model client for routing to underlying models */
  multiProviderClient: ModelClient
}

export class MoaDispatchModelClient implements ModelClient {
  readonly provider = 'moa'
  readonly model = 'moa'

  constructor(private readonly options: {
    configAdapter: MoaConfigAdapter
    multiProviderClient: ModelClient
  }) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const presetId = request.model.startsWith('moa:')
      ? request.model.slice('moa:'.length)
      : request.model.startsWith('moa-')
        ? request.model.slice('moa-'.length)
        : request.model
    const preset = this.options.configAdapter.getPreset(presetId)
    if (!preset) {
      yield { kind: 'error', message: `MoA preset not found: ${presetId}`, code: 'moa_preset_not_found' }
      yield { kind: 'completed', stopReason: 'error' }
      return
    }

    const client = new MoaModelClient({
      configAdapter: this.options.configAdapter,
      preset,
      multiProviderClient: this.options.multiProviderClient
    })
    yield* client.stream(request)
  }
}

export class MoaModelClient implements ModelClient {
  readonly provider = 'moa'
  readonly model: string

  private configAdapter: MoaConfigAdapter
  private preset: MoaPreset
  private multiProviderClient: ModelClient

  constructor(options: MoaModelClientOptions) {
    this.configAdapter = options.configAdapter
    this.preset = options.preset
    this.multiProviderClient = options.multiProviderClient
    this.model = `moa:${options.preset.id}`
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const startTime = Date.now()
    // Trace is request-local so concurrent streams never pollute each other's
    // layer accumulation.
    const trace: Partial<MoaTrace> | undefined = this.configAdapter.isTracingEnabled()
      ? { traceId: generateTraceId(), presetId: this.preset.id, usedDynamicRouting: false, layers: [] }
      : undefined

    try {
      // Execute MoA layers sequentially: proposers → aggregator
      let proposerOutputs: string[] = []

      for (const layer of this.preset.layers) {
        if (layer.type === 'proposer') {
          proposerOutputs = await this.executeProposerLayer(layer, request, trace)
        } else if (layer.type === 'aggregator') {
          // Aggregator layer receives proposer outputs as context
          yield* this.executeAggregatorLayer(layer, request, proposerOutputs, trace)
        }
      }

      // Finalize trace
      if (trace) {
        trace.totalDurationMs = Date.now() - startTime
      }
    } catch (error) {
      // Graceful degradation: fall back to first proposer model
      console.error('[MoA] Execution failed, falling back to single model:', error)
      const fallbackModel = this.preset.layers[0]?.models[0]
      if (fallbackModel) {
        const { modelId, providerId } = this.configAdapter.parseModelReference(fallbackModel)
        const fallbackRequest: ModelRequest = {
          ...request,
          model: modelId,
          providerId
        }
        yield* this.multiProviderClient.stream(fallbackRequest)
      } else {
        throw error
      }
    }
  }

  /**
   * Execute proposer layer - run all proposers in parallel, collect outputs
   */
  private async executeProposerLayer(
    layer: MoaLayer,
    request: ModelRequest,
    trace: Partial<MoaTrace> | undefined
  ): Promise<string[]> {
    const startTime = Date.now()
    const maxConcurrent = Math.max(
      1,
      this.preset.maxConcurrency ?? this.configAdapter.getMaxConcurrentProposers()
    )

    const runProposer = async (modelRef: string, index: number): Promise<string> => {
      const { modelId, providerId } = this.configAdapter.parseModelReference(modelRef)

      // Optional role specialization (SMoA technique)
      const roleDescription = layer.roleDescriptions?.[index]
      const enhancedSystemPrompt = roleDescription
        ? `${request.systemPrompt || ''}\n\nYour role: ${roleDescription}`.trim()
        : request.systemPrompt

      const proposerRequest: ModelRequest = {
        ...request,
        model: modelId,
        providerId,
        tools: [],
        requiredToolName: undefined,
        systemPrompt: enhancedSystemPrompt,
        temperature: layer.temperature,
        maxTokens: layer.maxTokens
      }

      // Stream and collect full response
      let fullResponse = ''
      for await (const chunk of this.multiProviderClient.stream(proposerRequest)) {
        if (chunk.kind === 'assistant_text_delta') {
          fullResponse += chunk.text
        }
      }

      return fullResponse
    }

    // Genuine concurrency cap: only create the promises for the current batch,
    // so at most maxConcurrent proposer streams are in flight at once.
    const outputs: string[] = []
    for (let i = 0; i < layer.models.length; i += maxConcurrent) {
      if (request.abortSignal.aborted) {
        throw request.abortSignal.reason ?? new Error('MoA request aborted')
      }
      const batch = layer.models.slice(i, i + maxConcurrent)
      const batchResults = await Promise.allSettled(
        batch.map((modelRef, batchIndex) => runProposer(modelRef, i + batchIndex))
      )
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.trim()) outputs.push(result.value)
      }
    }

    // Record trace
    if (trace) {
      trace.layers!.push({
        type: 'proposer',
        models: layer.models,
        durationMs: Date.now() - startTime,
        tokenCounts: {}
      })
    }

    return outputs
  }

  /**
   * Execute aggregator layer - synthesize proposer outputs into final response
   */
  private async *executeAggregatorLayer(
    layer: MoaLayer,
    request: ModelRequest,
    proposerOutputs: string[],
    trace: Partial<MoaTrace> | undefined
  ): AsyncIterable<ModelStreamChunk> {
    const startTime = Date.now()

    // Use first aggregator model (typically only one)
    const aggregatorModelRef = layer.models[0]
    if (!aggregatorModelRef) {
      throw new Error('Aggregator layer must have at least one model')
    }

    const { modelId, providerId } = this.configAdapter.parseModelReference(aggregatorModelRef)

    // Build aggregation prompt - inject proposer outputs as context
    const contextPlan = planMoaContext({
      latestUserMessage: '',
      referenceOutputs: proposerOutputs,
      maxContextTokens: this.preset.contextBudgetTokens ?? 32_000,
      reservedOutputTokens: layer.maxTokens ?? 4_096
    })
    const aggregationPrompt = this.buildAggregationPrompt(contextPlan.referenceOutputs, request.systemPrompt)

    const aggregatorRequest: ModelRequest = {
      ...request,
      model: modelId,
      providerId,
      systemPrompt: aggregationPrompt,
      temperature: layer.temperature,
      maxTokens: layer.maxTokens
    }

    // Stream aggregator response
    for await (const chunk of this.multiProviderClient.stream(aggregatorRequest)) {
      yield chunk
    }

    // Record trace
    if (trace) {
      trace.layers!.push({
        type: 'aggregator',
        models: layer.models,
        durationMs: Date.now() - startTime,
        tokenCounts: {}
      })
    }
  }

  /**
   * Build aggregation prompt - inject proposer outputs as reference material
   */
  private buildAggregationPrompt(proposerOutputs: string[], originalSystemPrompt?: string): string {
    const basePrompt = originalSystemPrompt || ''

    const proposerSection = proposerOutputs
      .map((output, i) => `### Response ${i + 1}:\n${output}`)
      .join('\n\n')

    return `${basePrompt}

You are synthesizing multiple responses into a single, high-quality answer. Below are ${proposerOutputs.length} independent responses to the user's query. Your task:

1. Identify common themes and consensus points
2. Resolve contradictions by favoring the most accurate/well-supported claims
3. Combine unique insights from each response
4. Produce a coherent, comprehensive final answer

Do not simply concatenate the responses. Synthesize them into a unified, high-quality response that is better than any individual response.

---

${proposerSection}

---

Now, synthesize these responses into your final answer:`.trim()
  }
}

function generateTraceId(): string {
  return `moa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
