import { describe, expect, it, vi } from 'vitest'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { buildBrowserUseToolProviders } from '../tool/browser-use-tool-provider.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'

const browserConfig: KunCapabilitiesConfig['browserUse'] = {
  enabled: true,
  mode: 'public',
  approvalMode: 'auto-safe',
  maxTabs: 2,
  maxObservationActionsPerTurn: 2,
  maxInteractionActionsPerTurn: 1,
  maxSnapshotNodes: 250,
  maxSnapshotTextChars: 20_000,
  maxImageDimension: 1280,
  idleTimeoutMs: 300_000
}

const request: ModelRequest = {
  threadId: 'thread',
  turnId: 'turn',
  model: 'relay-model',
  prefix: [],
  history: [],
  tools: [],
  abortSignal: new AbortController().signal
}

function browserTool() {
  return buildBrowserUseToolProviders(browserConfig, {
    controller: {
      readiness: () => ({ available: true }),
      execute: vi.fn()
    }
  }).providers[0]!.tools[0]!
}

describe('Anthropic-compatible tool schema projection', () => {
  it('projects browser_use to a strict-relay-safe object schema while retaining the action enum', () => {
    const tool = browserTool()
    const wire = createCompatRequestCodecs().build({
      request,
      model: request.model,
      messages: [],
      tools: [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }],
      stream: false,
      endpointFormat: 'messages',
      baseUrl: 'https://relay.example/v1',
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })
    const schema = (wire.tools as Array<{ input_schema: Record<string, unknown> }>)[0]!.input_schema
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['action'])
    expect(schema).not.toHaveProperty('oneOf')
    expect(schema).not.toHaveProperty('anyOf')
    expect(schema).not.toHaveProperty('allOf')
    expect((schema.properties as Record<string, { enum?: string[] }>).action.enum).toContain('open')
  })

  it('leaves the canonical browser_use union available to non-Messages providers', () => {
    const tool = browserTool()
    const wire = createCompatRequestCodecs().build({
      request,
      model: request.model,
      messages: [],
      tools: [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }],
      stream: false,
      endpointFormat: 'chat_completions',
      baseUrl: 'https://relay.example/v1',
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })
    const schema = (wire.tools as Array<{ function: { parameters: Record<string, unknown> } }>)[0]!
      .function.parameters
    expect(schema.oneOf).toEqual(expect.any(Array))
  })
})
