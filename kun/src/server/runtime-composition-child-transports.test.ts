import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { createRuntimeRegistry } from './runtime-composition-registry.js'

type Registry = ReturnType<typeof createRuntimeRegistry>
const captured: { registry?: Registry } = {}

vi.mock('./runtime-composition-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime-composition-registry.js')>()
  return {
    ...actual,
    createRuntimeRegistry: (...args: Parameters<typeof actual.createRuntimeRegistry>) => {
      const registry = actual.createRuntimeRegistry(...args)
      captured.registry = registry
      return registry
    }
  }
})

const { createKunServeRuntime } = await import('./runtime-factory.js')

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('child delegated runtime transports', () => {
  it('registers the session-layer transports so dispatched Codex/Pi workers are routable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-child-transports-'))
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }))
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir,
      runtimeToken: 'child-transports-token', apiKey: '',
      baseUrl: 'http://127.0.0.1:9', model: 'model',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false
    })
    cleanups.push(async () => { await runtime.shutdown?.() })
    const registry = captured.registry
    expect(registry).toBeDefined()
    const { core } = registry!.services.model
    const child = registry!.createChildDelegatedRuntime({
      threads: core.threadService,
      turns: registry!.services.turnService,
      sessionStore: core.sessionStore,
      threadStore: core.threadStore,
      events: core.events,
      ids: core.ids,
      prefix: core.prefix,
      toolPolicy: 'inherit',
      skillsEnabled: false,
      instructionsEnabled: false,
      memoryEnabled: false
    })
    const runtimes = (child?.router as unknown as {
      deps: { runtimes(): Record<string, unknown> }
    }).deps.runtimes()
    expect(Object.keys(runtimes)).toEqual(expect.arrayContaining(['acp', 'codex-app-server', 'pi-rpc']))
  })
})
