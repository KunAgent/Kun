import { once } from 'node:events'
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import { WorkflowWebhookServer } from './workflow-webhook-server'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function createBridgeServer(settings: AppSettingsV1, logError = vi.fn()): WorkflowWebhookServer {
  const run = vi.fn(async () => ({
    ok: true as const,
    status: 'success' as const,
    message: 'done',
    output: '',
    runId: 'run'
  }))
  return new WorkflowWebhookServer({
    loadSettings: async () => settings,
    logError,
    runWorkflowByRef: run,
    runWorkflowInternal: run,
    runForHook: run,
    runWorkflowForTool: run
  })
}

function listenerOf(server: WorkflowWebhookServer): Server | null {
  return (server as unknown as { server: Server | null }).server
}

describe('WorkflowWebhookServer listen gating', () => {
  it('serves an empty catalog while Workflow is enabled with no saved workflows', async () => {
    const settings = normalizeAppSettings({
      workflow: { enabled: true, workflows: [] }
    } as unknown as AppSettingsV1)
    settings.workflow.webhookPort = 0
    const server = createBridgeServer(settings)
    server.sync(settings)

    const listener = listenerOf(server)
    expect(listener).not.toBeNull()
    await once(listener as Server, 'listening')
    const port = ((listener as Server).address() as AddressInfo).port
    cleanups.push(async () => {
      const closed = once(listener as Server, 'close')
      server.close()
      ;(listener as Server).closeAllConnections()
      await closed
    })

    const response = await fetch(`http://127.0.0.1:${port}/workflow/internal/list`, {
      method: 'POST',
      body: '{}'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, workflows: [] })
  })

  it('keeps listening after the last workflow is removed', async () => {
    const settings = normalizeAppSettings({
      workflow: { enabled: true, workflows: [{ id: 'only', enabled: true }] }
    } as AppSettingsV1)
    settings.workflow.webhookPort = 0
    const server = createBridgeServer(settings)
    server.sync(settings)
    const listener = listenerOf(server)
    await once(listener as Server, 'listening')
    cleanups.push(async () => {
      const closed = once(listener as Server, 'close')
      server.close()
      ;(listener as Server).closeAllConnections()
      await closed
    })

    server.sync({ ...settings, workflow: { ...settings.workflow, workflows: [] } })

    expect(listenerOf(server)).toBe(listener)
  })

  it('does not listen while Workflow is disabled', () => {
    const settings = normalizeAppSettings({
      workflow: { enabled: false, workflows: [{ id: 'saved', enabled: true }] }
    } as AppSettingsV1)
    const server = createBridgeServer(settings)

    server.sync(settings)

    expect(listenerOf(server)).toBeNull()
  })

  it('reports an occupied port and binds on the next sync', async () => {
    // Occupy a real port so the first bind fails with EADDRINUSE, as it would
    // when another process holds the configured webhook port.
    const blocker = createHttpServer()
    blocker.listen(0, '127.0.0.1')
    await once(blocker, 'listening')
    const occupiedPort = (blocker.address() as AddressInfo).port
    cleanups.push(
      () =>
        new Promise<void>((done) => {
          blocker.close(() => done())
        })
    )

    const settings = normalizeAppSettings({
      workflow: { enabled: true, workflows: [{ id: 'only', enabled: true }] }
    } as AppSettingsV1)
    settings.workflow.webhookPort = occupiedPort
    const logError = vi.fn()
    const server = createBridgeServer(settings, logError)

    server.sync(settings)
    await vi.waitFor(() => expect(logError).toHaveBeenCalled())
    expect(logError.mock.calls[0]?.[0]).toBe('workflow-webhook')
    expect(listenerOf(server)).toBeNull()

    // Freeing the port must let the existing retry path recover: sync() runs on
    // every settings save and on desktop-lease acquisition.
    await new Promise<void>((done) => blocker.close(() => done()))
    server.sync({ ...settings, workflow: { ...settings.workflow, webhookPort: 0 } })

    const retried = listenerOf(server)
    expect(retried).not.toBeNull()
    await once(retried as Server, 'listening')
    cleanups.push(async () => {
      const closed = once(retried as Server, 'close')
      server.close()
      ;(retried as Server).closeAllConnections()
      await closed
    })
  })
})
