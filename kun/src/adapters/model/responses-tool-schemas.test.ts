import { Ajv } from 'ajv'
import { describe, expect, it, vi } from 'vitest'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { buildBrowserUseToolProviders } from '../tool/browser-use-tool-provider.js'
import { CompatModelClient } from './compat-model-client.js'
import { createCompatRequestCodecs, normalizeToolSpecs } from './compat-request-builder.js'

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
  model: 'gpt-6.2-sol',
  prefix: [],
  history: [],
  tools: [],
  abortSignal: new AbortController().signal
}

function browserTool() {
  return buildBrowserUseToolProviders(browserConfig, {
    controller: { readiness: () => ({ available: true }), execute: vi.fn() }
  }).providers[0]!.tools[0]!
}

type WireTool = { name: string; strict?: boolean; parameters: Record<string, unknown> }

function responseTools(body: Record<string, unknown>, lite: boolean): WireTool[] {
  if (!lite) return body.tools as WireTool[]
  const input = body.input as Array<{ type: string; tools?: WireTool[] }>
  expect(input[0]!.type).toBe('additional_tools')
  return input[0]!.tools!
}

describe('Responses function tool schemas', () => {
  it.each([
    { name: 'OpenAI Responses', isCodex: false, isCodexLite: false },
    { name: 'Codex Responses', isCodex: true, isCodexLite: false },
    { name: 'Codex Responses Lite', isCodex: true, isCodexLite: true }
  ])('opts out of strict normalization for $name without rewriting canonical schemas', ({ isCodex, isCodexLite }) => {
    const tool = browserTool()
    const original = structuredClone(tool.inputSchema)
    const tools = normalizeToolSpecs([tool])
    for (const stream of [false, true]) {
      const body = createCompatRequestCodecs().build({
        request,
        model: request.model,
        messages: [{ role: 'user', content: 'hi' }],
        tools,
        stream,
        endpointFormat: 'responses',
        baseUrl: isCodex ? 'https://chatgpt.com/backend-api/codex' : 'https://api.openai.com/v1',
        isCodex,
        isCodexLite,
        codexNativeImageGeneration: false
      })
      const wireTool = responseTools(body, isCodexLite)[0]!
      expect(wireTool.name).toBe('browser_use')
      expect(wireTool.strict).toBe(false)
      expect(wireTool.parameters).toEqual(tools[0]!.inputSchema)
      expect(wireTool.parameters.required).toEqual(['action'])
      expect(wireTool.parameters.oneOf).toEqual(expect.any(Array))
    }
    expect(tool.inputSchema).toEqual(original)
  })

  it('keeps optional browser fields valid and rejects invalid action arguments locally', () => {
    const schema = browserTool().inputSchema
    const ajv = new Ajv({ strict: false, allErrors: true })
    const validate = ajv.compile(schema)
    expect(validate({ action: 'open', url: 'https://example.com' })).toBe(true)
    expect(validate({ action: 'scroll', direction: 'down' })).toBe(true)
    expect(validate({ action: 'scroll', direction: 'down', amount: 2000 })).toBe(true)
    expect(validate({ action: 'scroll', direction: 'down', amount: 0 })).toBe(false)
    expect(validate({ action: 'open', url: 'https://example.com', amount: 1 })).toBe(false)

    // Responses' implicit strict normalization makes every root field required,
    // contradicting the per-action additionalProperties: false envelopes.
    const strictEnvelope = { ...schema, required: Object.keys(schema.properties as object) }
    const validateStrict = ajv.compile(strictEnvelope)
    expect(validateStrict({ action: 'scroll', direction: 'down' })).toBe(false)
    expect(validateStrict.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'required', params: { missingProperty: 'amount' } })
    ]))
  })

  it('serializes strict: false inside the Codex Lite additional_tools request', async () => {
    const bodies: Record<string, unknown>[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: 'test-token',
      model: request.model,
      endpointFormat: 'responses',
      nonStreaming: true,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text'],
        responsesMode: 'lite'
      }),
      fetchImpl: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ output_text: 'ok' })
      }) as typeof fetch
    })
    for await (const chunk of client.stream({ ...request, tools: [browserTool()] })) {
      if (chunk.kind === 'error') throw new Error(chunk.message)
    }
    expect(bodies).toHaveLength(1)
    expect(responseTools(bodies[0]!, true)[0]).toMatchObject({
      name: 'browser_use', strict: false, parameters: { required: ['action'] }
    })
  })
})
