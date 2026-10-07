import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AdeConfigSchema } from '../config/kun-config.js'
import { createKunServeRuntime } from './runtime-factory.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function captureModel() {
  const schemas = new Map<string, string[]>()
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      stream?: boolean
      messages?: Array<{ role: string; content: unknown }>
      tools?: Array<{ function?: { name?: string } }>
    }
    const latest = [...(body.messages ?? [])].reverse().find((item) => item.role === 'user')
    const marker = JSON.stringify(latest?.content).match(/SCHEMA_CAPTURE:([a-z-]+)/)?.[1]
    if (marker) schemas.set(marker, (body.tools ?? []).flatMap((tool) => tool.function?.name ?? []))
    const message = { role: 'assistant', content: 'Done.' }
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: message }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    } else {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'fixture', choices: [{ index: 0, message, finish_reason: 'stop' }] }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture model failed to listen')
  return { schemas, baseUrl: `http://127.0.0.1:${address.port}` }
}

describe('Code collaboration model tools across configuration reloads', () => {
  it('keeps ordinary delegation available across advanced collaboration configuration reloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-collaboration-schema-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const fixture = await captureModel()
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir: join(root, 'data'),
      runtimeToken: 'fixture', apiKey: 'fixture', baseUrl: fixture.baseUrl,
      model: 'fixture-model', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false, storage: { backend: 'file' },
      ade: AdeConfigSchema.parse({ enabled: false })
    })
    cleanups.push(async () => { await runtime.shutdown?.() })
    const manager = await runtime.threadService.create({
      workspace: root, model: 'fixture-model', mode: 'agent', workspaceMode: 'code',
      harnessId: 'kun', collaboration: { enabled: true }
    })
    const send = async (threadId: string, marker: string): Promise<string[]> => {
      const admitted = await runtime.turnService.startTurn({ threadId, request: {
        prompt: `SCHEMA_CAPTURE:${marker}`, clientSurface: 'gui', mode: 'agent', orchestration: 'direct'
      } })
      expect(await runtime.runTurn(threadId, admitted.turnId)).toBe('completed')
      const names = fixture.schemas.get(marker)
      expect(names).toBeDefined()
      return names!
    }
    expect(await send(manager.id, 'startup-disabled')).toContain('worker_create')
    for (const marker of ['first-save', 'second-save']) {
      expect(await runtime.applyConfig({ ade: AdeConfigSchema.parse({ enabled: true }) }))
        .toMatchObject({ ok: true })
      const names = await send(manager.id, marker)
      expect(names).toContain('harness_list')
      expect(names).toContain('worker_create')
      expect(names).toContain('worker_stop')
      expect(names.filter((name) => name === 'worker_create')).toHaveLength(1)
    }
    await runtime.applyConfig({ ade: AdeConfigSchema.parse({ enabled: false }) })
    const controls = await send(manager.id, 'globally-disabled')
    expect(controls).toContain('harness_list')
    expect(controls).toContain('worker_stop')
    expect(controls).toContain('worker_create')
    await runtime.applyConfig({ ade: AdeConfigSchema.parse({ enabled: true }) })
    const ordinary = await runtime.threadService.create({ workspace: root, model: 'fixture-model', mode: 'agent', workspaceMode: 'code' })
    const ordinaryNames = await send(ordinary.id, 'ordinary-code')
    expect(ordinaryNames).toContain('harness_list')
    expect(ordinaryNames).toContain('worker_create')
  }, 30_000)
})
