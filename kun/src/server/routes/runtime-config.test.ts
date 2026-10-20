import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '../read-json-body.js'
import { applyRuntimeConfig, RUNTIME_CONFIG_APPLY_MAX_BODY_BYTES } from './runtime-config.js'
import type { ServerRuntime } from './server-runtime.js'

/** A valid apply body whose provider catalog alone is larger than the control-plane default. */
function largeCatalogBody(providerCount: number): string {
  const providers = Object.fromEntries(Array.from({ length: providerCount }, (_, p) => [`provider-${p}`, {
    kind: 'http',
    baseUrl: 'https://example.test/v1',
    apiKey: '',
    models: Array.from({ length: 500 }, (_, i) => `vendor/model-${String(i).padStart(4, '0')}-catalog-entry`)
  }]))
  return JSON.stringify({ serve: { providers } })
}

function applyRequest(body: string): Request {
  return new Request('http://127.0.0.1/v1/runtime/config/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
}

function runtimeStub() {
  const applyConfig = vi.fn(async () => ({ ok: true as const, applied: [], restartRequired: [] }))
  return { runtime: { applyConfig } as unknown as ServerRuntime, applyConfig }
}

describe('runtime config apply body budget', () => {
  it('accepts a provider catalog larger than the 1 MiB control-plane default', async () => {
    const body = largeCatalogBody(70)
    expect(Buffer.byteLength(body)).toBeGreaterThan(DEFAULT_MAX_JSON_BODY_BYTES)
    const { runtime, applyConfig } = runtimeStub()
    const response = await applyRuntimeConfig(runtime, applyRequest(body))
    expect(response.status).toBe(200)
    expect(applyConfig).toHaveBeenCalledOnce()
    const applied = (applyConfig.mock.calls[0] as unknown[])[0] as { serve: { providers: Record<string, unknown> } }
    expect(Object.keys(applied.serve.providers)).toHaveLength(70)
  })

  it('still rejects bodies past the route budget before parsing them', async () => {
    const body = JSON.stringify({ serve: { model: 'x'.repeat(RUNTIME_CONFIG_APPLY_MAX_BODY_BYTES) } })
    const { runtime, applyConfig } = runtimeStub()
    const response = await applyRuntimeConfig(runtime, applyRequest(body))
    expect(response.status).toBe(413)
    expect(applyConfig).not.toHaveBeenCalled()
  })
})
