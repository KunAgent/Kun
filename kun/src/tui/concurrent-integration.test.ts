import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import { createApprovalRequest } from '../domain/approval.js'
import { readRuntimeDiscovery } from '../server/runtime-discovery.js'
import { startKunServe, type KunServeHandle } from '../server/runtime-factory.js'
import { KunTuiClient, TuiClientError, resolveTuiConnection } from './client.js'
import type { TuiOptions } from './options.js'

const roots: string[] = []
const servers: KunServeHandle[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('explicit TUI attachment and GUI-style client coexistence', () => {
  it('shares one event stream in --no-start mode and retires an approval decided by the other client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-concurrent-'))
    roots.push(root)
    const runtimeToken = 'integration-runtime-token'
    const server = await startKunServe({
      host: '127.0.0.1',
      port: 0,
      dataDir: root,
      runtimeToken,
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9',
      model: 'integration-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })
    servers.push(server)

    const options: TuiOptions = {
      runtimeToken: '',
      dataDir: root,
      workspace: root,
      continueLatest: false,
      noStart: true,
      help: false
    }
    const connection = await resolveTuiConnection(options)
    expect(connection).toMatchObject({ discovered: true, runtimeToken })
    expect(connection.runtimeInfo.startedAt).toBe((await server.runtime.info()).startedAt)

    // One client represents the terminal and the other the Electron renderer:
    // both authenticate to and mutate the same serve-mode composition root.
    const terminalClient = new KunTuiClient(connection)
    const guiClient = new KunTuiClient(connection)
    const thread = await terminalClient.createThread({
      title: 'Shared runtime',
      workspace: root,
      model: 'integration-model',
      mode: 'agent'
    })

    const terminalEvents: RuntimeEvent[] = []
    const guiEvents: RuntimeEvent[] = []
    const terminalAbort = new AbortController()
    const guiAbort = new AbortController()
    const terminalConnected = deferred<void>()
    const guiConnected = deferred<void>()
    const terminalSubscription = terminalClient.subscribeThreadEvents({
      threadId: thread.id,
      sinceSeq: 0,
      signal: terminalAbort.signal,
      onEvent: (event) => { terminalEvents.push(event) },
      onConnection: (state) => { if (state === 'connected') terminalConnected.resolve() }
    })
    const guiSubscription = guiClient.subscribeThreadEvents({
      threadId: thread.id,
      sinceSeq: 0,
      signal: guiAbort.signal,
      onEvent: (event) => { guiEvents.push(event) },
      onConnection: (state) => { if (state === 'connected') guiConnected.resolve() }
    })

    try {
      await Promise.all([terminalConnected.promise, guiConnected.promise])
      await server.runtime.events.record({
        kind: 'turn_started',
        threadId: thread.id,
        turnId: 'turn_shared',
        status: 'running'
      })

      const approval = createApprovalRequest({
        id: 'approval_shared',
        threadId: thread.id,
        turnId: 'turn_shared',
        toolName: 'write_file',
        summary: 'Write the shared workspace'
      })
      const decision = server.runtime.approvalGate.request(approval)
      await server.runtime.events.record({
        kind: 'approval_requested',
        threadId: thread.id,
        turnId: approval.turnId,
        approvalId: approval.id,
        toolName: approval.toolName,
        status: 'pending',
        summary: approval.summary
      })

      await waitFor(() => terminalEvents.some((event) => event.kind === 'approval_requested'))
      await waitFor(() => guiEvents.some((event) => event.kind === 'approval_requested'))
      const terminalSeqs = terminalEvents.map((event) => event.seq)
      const guiSeqs = guiEvents.map((event) => event.seq)
      expect(terminalSeqs).toEqual([...terminalSeqs].sort((a, b) => a - b))
      expect(guiSeqs).toEqual(terminalSeqs)

      await terminalClient.decideApproval(approval.id, 'allow')
      await expect(decision).resolves.toBe('allow')
      await expect(guiClient.decideApproval(approval.id, 'deny')).rejects.toMatchObject({
        status: 409
      } satisfies Partial<TuiClientError>)
      await waitFor(() => guiEvents.some((event) => event.kind === 'approval_resolved'))
      expect(server.runtime.approvalGate.pending(thread.id)).toEqual([])
    } finally {
      terminalAbort.abort()
      guiAbort.abort()
      await Promise.all([terminalSubscription, guiSubscription])
    }
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    expect(await readRuntimeDiscovery(root)).toBeNull()
  }, 30_000)

  it('does not publish discovery when the HTTP bind fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-bind-failure-'))
    roots.push(root)
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => resolve())
    })
    const address = blocker.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      await expect(startKunServe({
        host: '127.0.0.1',
        port,
        dataDir: root,
        runtimeToken: 'bind-failure-token',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:9',
        model: 'integration-model',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        tokenEconomyMode: false,
        insecure: false
      })).rejects.toBeDefined()
      expect(await readRuntimeDiscovery(root)).toBeNull()
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  }, 30_000)
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for concurrent runtime state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
