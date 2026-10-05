import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import { INTERNAL_BODY_LIMIT_BYTES } from './schedule-runtime-helpers'
import { WorkflowWebhookServer } from './workflow-webhook-server'
import { deferred } from './workflow-test-deferred'

const fixtures: { drain: () => Promise<void> }[] = []
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.drain()))
})

function createFixture() {
  const settings = normalizeAppSettings({
    workflow: { enabled: true, workflows: [{
      id: 'webhook', enabled: true, nodes: [{ id: 'trigger', type: 'webhook-trigger', config: { path: '/hook', method: 'POST' } }]
    }] }
  } as AppSettingsV1)
  const gate = deferred()
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
    loadSettings: async () => settings, logError: vi.fn(),
    runWorkflowByRef: run, runWorkflowInternal: run, runForHook: run, runWorkflowForTool: run
  })
  const requests: { stream: PassThrough; task: Promise<void> }[] = []
  const send = (path = '/workflow/run', body?: string) => {
    const stream = new PassThrough()
    const req = Object.assign(stream, { url: path, method: 'POST', headers: {} }) as unknown as IncomingMessage
    const response = {
      statusCode: 0, headersSent: false, destroyed: false, body: '',
      writeHead(status: number) { this.statusCode = status; this.headersSent = true },
      end(body: string) { this.body = body }
    }
    const task = (server as unknown as {
      handleWebhookRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleWebhookRequest(req, response as unknown as ServerResponse)
    requests.push({ stream, task })
    if (body !== undefined) stream.end(body)
    return { stream, response, task }
  }
  const fixture = {
    send, run, peak: () => peak,
    async drain() {
      for (const { stream } of requests) {
        if (!stream.destroyed && !stream.writableEnded) stream.end('{"workflow":"cleanup"}')
      }
      gate.resolve()
      await Promise.all(requests.map(({ task }) => task))
    }
  }
  fixtures.push(fixture)
  return fixture
}

describe('WorkflowWebhookServer run admission', () => {
  it('reserves at most four leases before eight parallel request bodies complete', async () => {
    const fixture = createFixture()
    const requests = Array.from({ length: 8 }, () => fixture.send())
    await nextTurn()
    for (const [index, request] of requests.entries()) request.stream.end(JSON.stringify({ workflow: `workflow-${index}` }))
    await nextTurn()

    expect(fixture.run).toHaveBeenCalledTimes(4)
    expect(fixture.peak()).toBe(4)
    expect(requests.filter(({ response }) => response.statusCode === 503)).toHaveLength(4)
    await fixture.drain()
    expect(requests.filter(({ response }) => response.statusCode === 200)).toHaveLength(4)
  })

  it('shares the same budget across public, internal, hook-run and webhook routes', async () => {
    const fixture = createFixture()
    const paths = ['/workflow/run', '/workflow/internal/run', '/workflow/internal/hook-run', '/hook']
    for (const [index, path] of paths.entries()) fixture.send(path, JSON.stringify({ workflow: `workflow-${index}` }))
    await nextTurn()
    expect(fixture.run).toHaveBeenCalledTimes(4)
    const overflow = paths.map((path) => fixture.send(path, '{"workflow":"overflow"}'))
    await nextTurn()

    expect(overflow.map(({ response }) => response.statusCode)).toEqual([503, 503, 503, 503])
    expect(fixture.peak()).toBe(4)
    const listing = fixture.send('/workflow/internal/list')
    await listing.task
    expect(listing.response.statusCode).toBe(200)
  })

  it.each(['malformed', 'oversized', 'aborted'] as const)('releases a reserved lease after a %s body', async (failure) => {
    const fixture = createFixture()
    const requests = Array.from({ length: 4 }, () => fixture.send())
    await nextTurn()
    const overflow = fixture.send('/workflow/internal/run', '{"workflow":"overflow"}')
    await nextTurn()
    expect(overflow.response.statusCode).toBe(503)

    if (failure === 'aborted') requests[0].stream.destroy(new Error('request aborted'))
    else requests[0].stream.end(failure === 'malformed' ? '{bad json' : 'x'.repeat(INTERNAL_BODY_LIMIT_BYTES + 1))
    await requests[0].task
    expect(requests[0].response.statusCode).toBe(failure === 'malformed' ? 400 : 500)

    const replacement = fixture.send('/workflow/internal/hook-run', '{"workflow":"replacement"}')
    await nextTurn()
    expect(fixture.run).toHaveBeenCalledTimes(1)
    const extra = fixture.send('/workflow/run', '{"workflow":"extra"}')
    await nextTurn()
    expect(extra.response.statusCode).toBe(503)
    for (const [index, request] of requests.slice(1).entries()) request.stream.end(JSON.stringify({ workflow: `workflow-${index}` }))
    await nextTurn()
    expect(fixture.peak()).toBe(4)
    await fixture.drain()
    expect(replacement.response.statusCode).toBe(200)
  })

  it('releases webhook leases after a rejected detached run without writing a second response', async () => {
    const fixture = createFixture()
    fixture.run.mockRejectedValueOnce(new Error('run failed'))
    const request = fixture.send('/hook', '{}')
    await request.task
    expect(request.response.statusCode).toBe(200)
    const next = Array.from({ length: 4 }, (_, index) => fixture.send('/workflow/run', JSON.stringify({ workflow: `workflow-${index}` })))
    await nextTurn()
    expect(fixture.run).toHaveBeenCalledTimes(5)
    await fixture.drain()
    expect(next.every(({ response }) => response.statusCode === 200)).toBe(true)
  })

  it.each(['/workflow/run', '/workflow/internal/run', '/workflow/internal/hook-run'])('releases %s leases when execution throws', async (path) => {
    const fixture = createFixture()
    fixture.run.mockRejectedValueOnce(new Error('run failed'))
    const request = fixture.send(path, '{"workflow":"failure"}')
    await request.task
    expect(request.response.statusCode).toBe(500)
    const next = Array.from({ length: 4 }, (_, index) => fixture.send('/workflow/run', JSON.stringify({ workflow: `workflow-${index}` })))
    await nextTurn()
    expect(fixture.run).toHaveBeenCalledTimes(5)
    await fixture.drain()
    expect(next.every(({ response }) => response.statusCode === 200)).toBe(true)
  })
})
