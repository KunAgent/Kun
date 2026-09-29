import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localModelGatewayApplyIssue } from './runtime-factory-config.js'
import { createKunServeRuntime } from './runtime-factory.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('localModelGatewayApplyIssue', () => {
  const credentials = (hasKey: boolean) => ({ hasKey: () => hasKey })

  it('passes when the gateway is disabled or absent', () => {
    expect(localModelGatewayApplyIssue({ host: '127.0.0.1' }, credentials(false))).toBeNull()
    expect(localModelGatewayApplyIssue(
      { host: '0.0.0.0', localModelGateway: { enabled: false, exposeProviderModels: false } },
      credentials(false)
    )).toBeNull()
  })

  it('rejects an enabled gateway without an independent key', () => {
    const issue = localModelGatewayApplyIssue(
      { host: '127.0.0.1', localModelGateway: { enabled: true, exposeProviderModels: false } },
      credentials(false)
    )
    expect(issue).toMatchObject({ code: 'gateway_key_missing' })
  })

  it('rejects an enabled gateway on a non-loopback host', () => {
    const issue = localModelGatewayApplyIssue(
      { host: '0.0.0.0', localModelGateway: { enabled: true, exposeProviderModels: false } },
      credentials(true)
    )
    expect(issue).toMatchObject({ code: 'gateway_non_loopback_host' })
  })

  it('passes when enabled with a key on a loopback host', () => {
    expect(localModelGatewayApplyIssue(
      { host: '127.0.0.1', localModelGateway: { enabled: true, exposeProviderModels: false } },
      credentials(true)
    )).toBeNull()
  })
})

async function serveRuntime(overrides: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-hot-apply-'))
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }))
  const runtime = await createKunServeRuntime({
    host: '127.0.0.1', port: 0, dataDir,
    runtimeToken: 'hot-apply-token', apiKey: '',
    baseUrl: 'http://127.0.0.1:9', model: 'model-before',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    tokenEconomyMode: false, insecure: false,
    ...overrides
  })
  cleanups.push(async () => { await runtime.shutdown?.() })
  return runtime
}

async function enableGatewayInRegistry(runtime: Awaited<ReturnType<typeof serveRuntime>>, enabled = true) {
  const registry = runtime.modelConnections!
  const snapshot = await registry.snapshot()
  await registry.updateGlobals({
    expectedRevision: snapshot.revision,
    proxy: snapshot.proxy ?? { enabled: false, url: '' },
    routePools: snapshot.routePools ?? [],
    localModelGateway: { enabled, exposeProviderModels: false }
  })
}

describe('segmented local model gateway apply', () => {
  it('applies unrelated sections while rejecting an enabled gateway without a key', async () => {
    const runtime = await serveRuntime()
    await enableGatewayInRegistry(runtime)

    const result = await runtime.applyConfig({ serve: { model: 'model-after' } })

    expect(result).toMatchObject({
      ok: true,
      rejectedSections: { localModelGateway: { code: 'gateway_key_missing' } }
    })
    expect(runtime.defaultModel).toBe('model-after')
    expect(runtime.modelGateway?.enabled()).toBe(false)
  })

  it('commits the gateway once an independent key exists', async () => {
    const runtime = await serveRuntime()
    await runtime.modelGateway!.credentials.ensure()
    await enableGatewayInRegistry(runtime)

    const result = await runtime.applyConfig({ serve: { model: 'model-after' } })

    expect(result).toEqual({ ok: true })
    expect(runtime.defaultModel).toBe('model-after')
    expect(runtime.modelGateway?.enabled()).toBe(true)
  })

  it('keeps reporting the rejected section until the key is created', async () => {
    const runtime = await serveRuntime()
    await enableGatewayInRegistry(runtime)

    const first = await runtime.applyConfig({ serve: { model: 'model-two' } })
    const second = await runtime.applyConfig({ serve: { model: 'model-three' } })

    for (const result of [first, second]) {
      expect(result.ok).toBe(true)
      expect(result.ok && result.rejectedSections?.localModelGateway?.code).toBe('gateway_key_missing')
    }
    expect(runtime.defaultModel).toBe('model-three')
  })
})
