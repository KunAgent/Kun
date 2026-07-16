import { describe, it, expect, beforeEach } from 'vitest'
import { MoaModelClient } from './moa-model-client.js'
import { MoaConfigAdapter } from './moa-config.js'
import type { MoaPreset } from '../contracts/moa-types.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

describe('MoaModelClient', () => {
  let mockMultiProviderClient: ModelClient
  let configAdapter: MoaConfigAdapter
  let testPreset: MoaPreset

  beforeEach(() => {
    // Mock multi-provider client
    mockMultiProviderClient = {
      provider: 'mock',
      model: 'mock-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        // Return simple mock response
        yield { kind: 'assistant_text_delta', text: 'Mock response for ' }
        yield { kind: 'assistant_text_delta', text: request.model }
      }
    }

    // Create config adapter
    configAdapter = new MoaConfigAdapter({ rawConfig: {} })

    // Test preset with 2 proposers + 1 aggregator
    testPreset = {
      id: 'test-preset',
      name: 'Test Preset',
      description: 'Test preset for unit tests',
      layers: [
        {
          type: 'proposer',
          models: ['model-a', 'model-b']
        },
        {
          type: 'aggregator',
          models: ['model-agg']
        }
      ],
      dynamicRouting: false,
      costMultiplier: 3,
      enabled: true
    }
  })

  it('should_construct_with_correct_model_name', () => {
    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: mockMultiProviderClient
    })

    expect(client.model).toBe('moa:test-preset')
    expect(client.provider).toBe('moa')
  })

  it('should_execute_proposer_layer_in_parallel', async () => {
    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: mockMultiProviderClient
    })

    const request: ModelRequest = {
      threadId: 'test-thread',
      turnId: 'test-turn',
      model: 'moa-test-preset',
      systemPrompt: 'Test system prompt',
      prefix: [],
      history: [],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    // Should have received aggregator output
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every(c => c.kind === 'assistant_text_delta')).toBe(true)
  })

  it('runs reference models without tools while preserving tools for the aggregator', async () => {
    const requests: ModelRequest[] = []
    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: {
        provider: 'recording',
        model: 'recording',
        async *stream(request) {
          requests.push(request)
          yield { kind: 'assistant_text_delta', text: `answer:${request.model}` }
        }
      }
    })
    const request: ModelRequest = {
      threadId: 'thread', turnId: 'turn', model: 'moa:test-preset',
      prefix: [], history: [], abortSignal: new AbortController().signal,
      tools: [{ name: 'read', description: 'Read a file', inputSchema: {} }]
    }

    for await (const _chunk of client.stream(request)) { /* consume */ }

    expect(requests.slice(0, 2).every((item) => item.tools.length === 0)).toBe(true)
    expect(requests[2].tools).toEqual(request.tools)
  })

  it('aggregates successful references when one reference fails', async () => {
    let aggregationPrompt = ''
    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: {
        provider: 'partial',
        model: 'partial',
        async *stream(request) {
          if (request.model === 'model-a') throw new Error('advisor unavailable')
          if (request.model === 'model-agg') aggregationPrompt = request.systemPrompt ?? ''
          yield { kind: 'assistant_text_delta', text: `answer:${request.model}` }
        }
      }
    })

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream({
      threadId: 'thread', turnId: 'turn', model: 'moa:test-preset',
      prefix: [], history: [], tools: [], abortSignal: new AbortController().signal
    })) chunks.push(chunk)

    expect(aggregationPrompt).toContain('answer:model-b')
    expect(chunks.some((chunk) => chunk.kind === 'assistant_text_delta' && chunk.text === 'answer:model-agg')).toBe(true)
  })

  it('should_inject_role_descriptions_for_proposers', async () => {
    const presetWithRoles: MoaPreset = {
      ...testPreset,
      layers: [
        {
          type: 'proposer',
          models: ['model-a', 'model-b'],
          roleDescriptions: ['Analytical role', 'Creative role']
        },
        {
          type: 'aggregator',
          models: ['model-agg']
        }
      ]
    }

    // Track requests to verify role injection
    const requestedModels: string[] = []
    const mockClientWithTracking: ModelClient = {
      provider: 'mock',
      model: 'mock',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        requestedModels.push(request.model || 'unknown')
        yield { kind: 'assistant_text_delta', text: `Response from ${request.model}` }
      }
    }

    const client = new MoaModelClient({
      configAdapter,
      preset: presetWithRoles,
      multiProviderClient: mockClientWithTracking
    })

    const request: ModelRequest = {
      threadId: 'test-thread',
      turnId: 'test-turn',
      model: 'moa-test-preset',
      systemPrompt: 'Test system prompt',
      prefix: [],
      history: [],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    // Verify all models were called (2 proposers + 1 aggregator)
    expect(requestedModels).toContain('model-a')
    expect(requestedModels).toContain('model-b')
    expect(requestedModels).toContain('model-agg')
  })

  it('should_fall_back_to_single_model_on_error', async () => {
    let proposerCallCount = 0
    const failingClient: ModelClient = {
      provider: 'failing',
      model: 'failing-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        proposerCallCount++
        // First calls (proposers) fail, but fallback call succeeds
        if (proposerCallCount <= 2) {
          throw new Error('Proposer execution failed')
        }
        // Fallback succeeds
        yield { kind: 'assistant_text_delta', text: 'Fallback response' }
      }
    }

    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: failingClient
    })

    const request: ModelRequest = {
      threadId: 'test-thread',
      turnId: 'test-turn',
      model: 'moa-test-preset',
      systemPrompt: 'Test system prompt',
      prefix: [],
      history: [],
      tools: [],
      abortSignal: new AbortController().signal
    }

    // Should not throw, should fall back gracefully
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    // Should have received fallback response
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some(c => c.kind === 'assistant_text_delta')).toBe(true)
  })

  it('should_aggregate_proposer_outputs', async () => {
    let aggregatorSystemPrompt = ''

    const trackingClient: ModelClient = {
      provider: 'tracking',
      model: 'tracking-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        // Track aggregator's system prompt to verify proposer outputs are included
        if (request.model === 'model-agg') {
          aggregatorSystemPrompt = request.systemPrompt || ''
        }
        yield { kind: 'assistant_text_delta', text: `Output from ${request.model}` }
      }
    }

    const client = new MoaModelClient({
      configAdapter,
      preset: testPreset,
      multiProviderClient: trackingClient
    })

    const request: ModelRequest = {
      threadId: 'test-thread',
      turnId: 'test-turn',
      model: 'moa-test-preset',
      systemPrompt: 'Test system prompt',
      prefix: [],
      history: [],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    // Aggregator should receive proposer outputs in system prompt
    expect(aggregatorSystemPrompt).toContain('Response 1')
    expect(aggregatorSystemPrompt).toContain('Response 2')
    expect(aggregatorSystemPrompt).toContain('synthesizing')
  })
})
