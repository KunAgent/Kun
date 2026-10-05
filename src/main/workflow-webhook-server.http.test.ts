import { once } from 'node:events'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import { WorkflowWebhookServer } from './workflow-webhook-server'
import { deferred } from './workflow-test-deferred'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function createFixture() {
  const settings = normalizeAppSettings({
    workflow: { enabled: true, workflows: [{ id: 'enabled', enabled: true }] }
  } as AppSettingsV1)
  settings.workflow.webhookPort = 0
  const gate = deferred()
  const loadSettings = vi.fn(async () => settings)
  const logError = vi.fn()
  let active = 0
  let peak = 0
  const run = vi.fn(async (id: unknown) => {
    active += 1
    peak = Math.max(peak, active)
    try {
      await gate.promise
      return { ok: true as const, status: 'success' as const, message: 'done', runId: String(id), output: 'done' }
    } finally {
      active -= 1
    }
  })
  const server = new WorkflowWebhookServer({
    loadSettings, logError, runWorkflowByRef: run, runWorkflowInternal: run,
    runForHook: run, runWorkflowForTool: run
  })
  server.sync(settings)
  const listener = (server as unknown as { server: Server }).server
  await once(listener, 'listening')
  const port = (listener.address() as AddressInfo).port
  const clients: ReturnType<typeof request>[] = []
  cleanups.push(async () => {
    gate.resolve()
    for (const client of clients) client.destroy()
    const closed = once(listener, 'close')
    server.close()
    listener.closeAllConnections()
    await closed
  })
  return {
    run, loadSettings, logError, peak: () => peak, finish: () => gate.resolve(),
    send(id: string, path = '/workflow/run') {
      const response = deferred<number>()
      const client = request({ hostname: '127.0.0.1', port, path, method: 'POST', agent: false }, (res) => {
        res.resume()
        res.on('end', () => response.resolve(res.statusCode ?? 0))
      })
      // An explicitly aborted client has no HTTP response.
      client.on('error', () => response.resolve(0))
      client.write(`{"workflow":${JSON.stringify(id)},"input":`)
      clients.push(client)
      return { client, response: response.promise }
    }
  }
}

describe('WorkflowWebhookServer HTTP admission', () => {
  it('caps eight real concurrent streaming HTTP requests at four runs', async () => {
    const fixture = await createFixture()
    const requests = Array.from({ length: 8 }, (_, index) => fixture.send(`workflow-${index}`))
    await vi.waitFor(() => expect(fixture.loadSettings).toHaveBeenCalledTimes(8))
    for (const { client } of requests) client.end('null}')
    await vi.waitFor(() => expect(fixture.run.mock.calls.length).toBeGreaterThanOrEqual(4))

    expect(fixture.run).toHaveBeenCalledTimes(4)
    expect(fixture.peak()).toBe(4)
    expect(new Set(fixture.run.mock.calls.map(([id]) => id)).size).toBe(4)
    fixture.finish()
    expect((await Promise.all(requests.map(({ response }) => response))).sort()).toEqual([200, 200, 200, 200, 503, 503, 503, 503])
  })

  it('returns an aborted body lease to the shared public and internal budget', async () => {
    const fixture = await createFixture()
    const aborted = fixture.send('aborted')
    await vi.waitFor(() => expect(fixture.loadSettings).toHaveBeenCalledTimes(1))
    aborted.client.destroy()
    await vi.waitFor(() => expect(fixture.logError).toHaveBeenCalled())

    const requests = ['/workflow/run', '/workflow/internal/run', '/workflow/internal/hook-run', '/workflow/run']
      .map((path, index) => fixture.send(`workflow-${index}`, path))
    for (const { client } of requests) client.end('null}')
    await vi.waitFor(() => expect(fixture.run).toHaveBeenCalledTimes(4))
    expect(fixture.peak()).toBe(4)
    fixture.finish()
    expect(await Promise.all(requests.map(({ response }) => response))).toEqual([200, 200, 200, 200])
  })
})
