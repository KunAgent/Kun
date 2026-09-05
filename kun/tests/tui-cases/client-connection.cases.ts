import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import type { ClientOwnedRuntimeHandle } from '../../src/cli/client-owned-runtime.js'
import { RuntimeInfoResponse } from '../../src/contracts/runtime-info.js'
import { ThreadSchema } from '../../src/contracts/threads.js'
import { publishRuntimeDiscovery } from '../../src/server/runtime-discovery.js'
import { KunTuiClient, TuiClientError, resolveTuiConnection } from '../../src/tui/client.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'
import type { TuiOptions } from '../../src/tui/options.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function runtimeInfo(overrides: Record<string, unknown> = {}): RuntimeInfoResponse {
  return RuntimeInfoResponse.parse({
    host: '127.0.0.1',
    port: 18899,
    dataDir: '/tmp/kun-data',
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    insecure: false,
    instanceId: 'gui-runtime',
    serviceVersion: '0.1.0',
    launchMode: 'gui',
    startedAt: '2026-07-22T00:00:00.000Z',
    pid: process.pid,
    capabilities: buildRuntimeCapabilityManifest({
      model: {
        id: 'model-a',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    }),
    ...overrides
  })
}

function thread(overrides: Record<string, unknown> = {}) {
  return ThreadSchema.parse({
    id: 'thr_1',
    title: 'Terminal thread',
    workspace: '/tmp/project',
    model: 'model-a',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    turns: [],
    ...overrides
  })
}

function options(overrides: Partial<TuiOptions> = {}): TuiOptions {
  return {
    runtimeToken: 'runtime-secret',
    dataDir: '/tmp/kun-data',
    workspace: '/tmp/project',
    continueLatest: false,
    noStart: false,
    help: false,
    ...overrides
  }
}

function modelSnapshot(revision = 1) {
  return {
    schemaVersion: 1 as const,
    revision,
    providers: [{
      id: 'provider-a', accountId: 'account:provider-a', name: 'Provider A',
      kind: 'http' as const, authType: 'api-key' as const,
      baseUrl: 'https://example.com/v1', endpointFormat: 'chat_completions' as const,
      useProxy: false, configured: true, models: ['model-a'], selectedModel: 'model-a'
    }],
    defaultProviderId: 'provider-a',
    defaultAccountId: 'account:provider-a',
    defaultModel: 'model-a',
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  }
}

function ownedRuntimeHandle(input: {
  dataDir: string
  buildId?: string
  stop?: ClientOwnedRuntimeHandle['stop']
}): ClientOwnedRuntimeHandle {
  const instanceId = 'tui-owned-runtime'
  const info = runtimeInfo({
    instanceId,
    dataDir: input.dataDir,
    ...(input.buildId ? { buildId: input.buildId } : {})
  })
  return {
    instanceId,
    ownerKind: 'tui',
    connection: {
      discovery: {
        version: 2,
        instanceId,
        pid: process.pid,
        startedAt: info.startedAt,
        host: '127.0.0.1',
        port: 18900,
        baseUrl: 'http://127.0.0.1:18900',
        runtimeToken: 'tui-owned-secret',
        insecure: false,
        serviceVersion: '0.1.0',
        ...(input.buildId ? { buildId: input.buildId } : {}),
        launchMode: 'shared',
        clientOwnerKind: 'tui'
      },
      info
    },
    stop: input.stop ?? vi.fn(async () => true)
  }
}

describe('resolveTuiConnection', () => {
  it('uses an explicit URL and token without discovery', async () => {
    const fetchImpl = vi.fn(async () => Response.json(runtimeInfo({ instanceId: 'gui-runtime' }))) as unknown as typeof fetch

    const result = await resolveTuiConnection(options({
      url: 'http://127.0.0.1:18899',
      runtimeToken: 'explicit-secret'
    }), fetchImpl)
    expect(result).toMatchObject({
      baseUrl: 'http://127.0.0.1:18899',
      discovered: false
    })
    expect(result.ownedRuntime).toBeUndefined()
    expect(new Headers((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe('Bearer explicit-secret')
  })

  it('starts and retains an exact TUI-owned runtime by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-client-'))
    roots.push(root)
    const buildId = 'a'.repeat(64)
    const owned = ownedRuntimeHandle({ dataDir: root, buildId })
    const startOwnedRuntime = vi.fn(async () => owned)
    const fetchImpl = vi.fn() as unknown as typeof fetch

    const connection = await resolveTuiConnection(
      options({ dataDir: root, runtimeToken: '' }),
      fetchImpl,
      { expectedBuildId: buildId, startOwnedRuntime }
    )

    expect(connection).toMatchObject({
      discovered: true,
      runtimeToken: 'tui-owned-secret',
      runtimeInfo: { instanceId: owned.instanceId }
    })
    expect(connection.ownedRuntime).toBe(owned)
    expect(startOwnedRuntime).toHaveBeenCalledWith(expect.objectContaining({
      dataDir: root,
      expectedBuildId: buildId,
      ownerKind: 'tui',
      runtimeFlavor: 'production'
    }))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not attach to or replace a discovered foreign owner in default mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-client-same-build-'))
    roots.push(root)
    const buildId = 'a'.repeat(64)
    await publishRuntimeDiscovery(root, {
      instanceId: 'gui-owned-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'same-build-secret',
      insecure: false,
      buildId,
      launchMode: 'shared',
      clientOwnerKind: 'gui'
    })
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const startOwnedRuntime = vi.fn(async () => {
      throw new Error(`Kun Runtime is already owned by gui process ${process.pid} for ${root}`)
    })

    const error = await resolveTuiConnection(
      options({ dataDir: root, runtimeToken: '' }),
      fetchImpl,
      { expectedBuildId: buildId, startOwnedRuntime }
    ).catch((value) => value)

    expect(String(error)).toContain('already owned by gui')
    expect(startOwnedRuntime).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('attaches to a discovered runtime only when --no-start is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-client-no-start-'))
    roots.push(root)
    const buildId = 'a'.repeat(64)
    await publishRuntimeDiscovery(root, {
      instanceId: 'gui-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'discovered-secret',
      insecure: false,
      buildId,
      launchMode: 'shared',
      clientOwnerKind: 'gui'
    })
    const fetchImpl = vi.fn(async () => Response.json(runtimeInfo({
      instanceId: 'gui-runtime',
      buildId
    }))) as unknown as typeof fetch
    const startOwnedRuntime = vi.fn()

    const connection = await resolveTuiConnection(
      options({ dataDir: root, runtimeToken: '', noStart: true }),
      fetchImpl,
      { expectedBuildId: buildId, startOwnedRuntime }
    )
    expect(connection).toMatchObject({
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'discovered-secret',
      runtimeInfo: { buildId }
    })
    expect(connection.ownedRuntime).toBeUndefined()
    expect(startOwnedRuntime).not.toHaveBeenCalled()
    expect(new Headers((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe('Bearer discovered-secret')
  })

  it('rejects a discovered build mismatch when --no-start is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-client-no-start-build-'))
    roots.push(root)
    const oldBuildId = 'a'.repeat(64)
    const expectedBuildId = 'b'.repeat(64)
    await publishRuntimeDiscovery(root, {
      instanceId: 'old-build-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'old-build-secret',
      insecure: false,
      buildId: oldBuildId
    })
    const fetchImpl = vi.fn(async () => Response.json(runtimeInfo({
      instanceId: 'old-build-runtime',
      buildId: oldBuildId
    }))) as unknown as typeof fetch
    const startOwnedRuntime = vi.fn()

    const error = await resolveTuiConnection(
      options({ dataDir: root, runtimeToken: '', noStart: true }),
      fetchImpl,
      { expectedBuildId, startOwnedRuntime }
    ).catch((value) => value)

    expect(error).toBeInstanceOf(TuiClientError)
    expect(error).toMatchObject({ code: 'runtime_build_mismatch' })
    expect(String(error)).toContain('different application build')
    expect(startOwnedRuntime).not.toHaveBeenCalled()
  })

  it('rejects unsafe and stale discovery without exposing its token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-client-stale-'))
    roots.push(root)
    await publishRuntimeDiscovery(root, {
      instanceId: 'stale-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'must-not-leak',
      insecure: false
    })
    const fetchImpl = vi.fn(async () => Response.json(runtimeInfo({ pid: process.pid + 1 }))) as unknown as typeof fetch
    const error = await resolveTuiConnection(options({ dataDir: root, runtimeToken: '', noStart: true }), fetchImpl).catch((value) => value)
    expect(error).toBeInstanceOf(TuiClientError)
    expect(String(error)).toContain('stale')
    expect(String(error)).not.toContain('must-not-leak')
  })
})
