import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import { RuntimeInfoResponse } from '../contracts/runtime-info.js'
import type { ClientOwnedRuntimeHandle } from '../cli/client-owned-runtime.js'
import {
  createTuiReconnectResolver,
  runTuiCommand
} from './index.js'
import type { TuiConnection } from './client.js'
import type { TuiOptions } from './options.js'

function runtimeInfo(dataDir: string): RuntimeInfoResponse {
  return RuntimeInfoResponse.parse({
    host: '127.0.0.1',
    port: 18899,
    dataDir,
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    insecure: false,
    instanceId: 'tui-owned-runtime',
    serviceVersion: '0.1.0',
    launchMode: 'shared',
    startedAt: '2026-09-02T00:00:00.000Z',
    pid: process.pid,
    capabilities: buildRuntimeCapabilityManifest({
      model: {
        id: 'model-a',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    })
  })
}

function tuiOptions(dataDir: string): TuiOptions {
  return {
    runtimeToken: '',
    dataDir,
    dataDirSource: 'argument',
    workspace: dataDir,
    continueLatest: false,
    noStart: false,
    help: false
  }
}

describe('runTuiCommand', () => {
  it('prints TUI help without requiring a terminal or a runtime', async () => {
    let stdout = ''
    const fetch = vi.fn()
    const code = await runTuiCommand(['--help'], {
      stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: vi.fn() },
      fetch: fetch as unknown as typeof globalThis.fetch
    })
    expect(code).toBe(0)
    expect(stdout).toContain('kun [tui options]')
    expect(stdout).toContain('starts one Runtime owned by')
    expect(stdout).toContain('cannot own the same data directory/flavor concurrently')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unsupported Node before checking TTY or runtime discovery', async () => {
    let stderr = ''
    const fetch = vi.fn()
    const code = await runTuiCommand([], {
      stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
      stdout: { isTTY: false, write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      fetch: fetch as unknown as typeof globalThis.fetch,
      nodeVersion: '22.13.0'
    })

    expect(code).toBe(69)
    expect(stderr).toContain('Node.js >=22.19.0 is required')
    expect(stderr).toContain('current Node.js is 22.13.0')
    expect(stderr).toContain('https://nodejs.org/')
    expect(stderr).not.toContain('a TTY is required')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects non-TTY use before discovery or terminal output', async () => {
    let stderr = ''
    let stdout = ''
    const fetch = vi.fn()
    const code = await runTuiCommand([], {
      stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
      stdout: { isTTY: false, write: (chunk: string) => { stdout += chunk } },
      stderr: { write: (chunk) => { stderr += chunk } },
      fetch: fetch as unknown as typeof globalThis.fetch,
      nodeVersion: '22.19.0'
    })
    expect(code).toBe(64)
    expect(stderr).toContain('a TTY is required')
    expect(stdout).not.toContain('\x1b[?1049h')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses an unpublished GUI-private writer instead of attaching to it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-private-gui-'))
    const dataDir = join(root, 'data')
    const settingsPath = join(root, 'gui', 'kun-settings.json')
    await mkdir(join(root, 'gui'), { recursive: true })
    await writeFile(settingsPath, JSON.stringify({
      provider: { providers: [] },
      agents: {
        kun: {
          dataDir,
          model: '',
          providerId: '',
          port: 18899,
          runtimeToken: 'legacy-token'
        }
      }
    }))
    let stderr = ''
    const fetch = vi.fn(async () => Response.json({ dataDir }))
    try {
      const code = await runTuiCommand([], {
        stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
        stdout: { isTTY: true, write: () => undefined },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: { KUN_GUI_SETTINGS_PATH: settingsPath },
        fetch: fetch as unknown as typeof globalThis.fetch,
        nodeVersion: '22.19.0'
      })

      expect(code).toBe(70)
      expect(stderr).toContain('older GUI Runtime')
      expect(stderr).toContain('close or update that GUI')
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stops the exact owned Runtime when initialization fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-init-cleanup-'))
    const dataDir = join(root, 'data')
    const stop = vi.fn(async () => true)
    const info = runtimeInfo(dataDir)
    const ownedRuntime: ClientOwnedRuntimeHandle = {
      instanceId: info.instanceId,
      ownerKind: 'tui',
      connection: {
        discovery: {
          version: 2,
          instanceId: info.instanceId,
          pid: process.pid,
          startedAt: info.startedAt,
          host: info.host,
          port: info.port,
          baseUrl: 'http://127.0.0.1:18899',
          runtimeToken: 'owned-secret',
          insecure: false,
          serviceVersion: info.serviceVersion,
          launchMode: 'shared',
          clientOwnerKind: 'tui'
        },
        info
      },
      stop
    }
    const resolveConnection = vi.fn(async (): Promise<TuiConnection> => ({
      baseUrl: ownedRuntime.connection.discovery.baseUrl,
      runtimeToken: ownedRuntime.connection.discovery.runtimeToken,
      runtimeInfo: info,
      discovered: true,
      ownedRuntime
    }))
    let stderr = ''
    try {
      const code = await runTuiCommand(['--data-dir', dataDir], {
        stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
        stdout: { isTTY: true, write: () => undefined },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: { KUN_GUI_SETTINGS_PATH: join(root, 'missing-settings.json') },
        fetch: vi.fn(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch,
        nodeVersion: '22.19.0',
        resolveConnection
      })

      expect(code).toBe(70)
      expect(stderr).toContain('(503)')
      expect(resolveConnection).toHaveBeenCalledOnce()
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('createTuiReconnectResolver', () => {
  it('never installs automatic reconnection for an owned Runtime', () => {
    const dataDir = '/tmp/kun-owned-reconnect'
    const info = runtimeInfo(dataDir)
    const ownedRuntime = {
      instanceId: info.instanceId,
      ownerKind: 'tui' as const,
      connection: {} as ClientOwnedRuntimeHandle['connection'],
      stop: vi.fn(async () => true)
    }
    const connection: TuiConnection = {
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'owned-secret',
      runtimeInfo: info,
      discovered: true,
      ownedRuntime
    }
    const resolveConnection = vi.fn()

    expect(createTuiReconnectResolver(
      connection,
      tuiOptions(dataDir),
      vi.fn() as unknown as typeof fetch,
      resolveConnection
    )).toBeUndefined()
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  it('keeps discovery refresh only for explicit attach mode', async () => {
    const dataDir = '/tmp/kun-external-reconnect'
    const info = runtimeInfo(dataDir)
    const attached: TuiConnection = {
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'external-secret',
      runtimeInfo: info,
      discovered: true
    }
    const resolveConnection = vi.fn(async () => ({
      ...attached,
      baseUrl: 'http://127.0.0.1:18900',
      runtimeToken: 'refreshed-secret'
    }))
    const reconnect = createTuiReconnectResolver(
      attached,
      { ...tuiOptions(dataDir), noStart: true },
      vi.fn() as unknown as typeof fetch,
      resolveConnection
    )

    await expect(reconnect?.()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:18900',
      runtimeToken: 'refreshed-secret'
    })
    expect(resolveConnection).toHaveBeenCalledOnce()
  })
})
