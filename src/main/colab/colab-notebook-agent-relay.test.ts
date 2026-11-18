import { describe, expect, it } from 'vitest'
import type { ColabNotebookAgentRequest } from '../../shared/colab/colab-notebook-types'
import { ColabBridgeServer } from './colab-bridge-server'
import { ColabNotebookAgentRelay } from './colab-notebook-agent-relay'

describe('ColabNotebookAgentRelay', () => {
  it('fails fast when the notebook page never acknowledges', async () => {
    const relay = new ColabNotebookAgentRelay(() => true)
    const id = relay.start({ kind: 'variables', workspaceRoot: '/ws' })
    const poll = await relay.wait(id, 7_000)
    expect(poll).toMatchObject({ status: 'done', result: { ok: false } })
    expect(poll?.status === 'done' && !poll.result.ok ? poll.result.message : '').toContain('not open')
    relay.shutdown()
  }, 10_000)

  it('reports running for acknowledged long requests, then delivers the result once', async () => {
    const sent: ColabNotebookAgentRequest[] = []
    const relay = new ColabNotebookAgentRelay((req) => {
      sent.push(req)
      return true
    })
    const id = relay.start({ kind: 'run', workspaceRoot: '/ws', cells: [2] })
    expect(sent[0]).toMatchObject({ requestId: id, kind: 'run', cells: [2] })
    relay.respond({ requestId: id, ack: true })
    expect(await relay.wait(id, 20)).toEqual({ status: 'running', requestId: id })

    setTimeout(() => relay.respond({ requestId: id, result: { ok: true, cells: [] } }), 10)
    expect(await relay.wait(id, 2_000)).toEqual({ status: 'done', requestId: id, result: { ok: true, cells: [] } })
    expect(await relay.wait(id, 10)).toBeNull()
    relay.shutdown()
  })

  it('serves notebook requests through the GUI bridge notebook routes', async () => {
    const relay = new ColabNotebookAgentRelay((req) => {
      queueMicrotask(() => {
        relay.respond({ requestId: req.requestId, ack: true })
        relay.respond({
          requestId: req.requestId,
          result: { ok: true, variables: [{ name: 'acc', typeName: 'float', summary: '0.9' }] }
        })
      })
      return true
    })
    const bridge = new ColabBridgeServer({} as never, () => ({}) as never, () => relay)
    const reply = { status: 0, body: '' }
    const res = {
      writeHead: (status: number) => {
        reply.status = status
      },
      end: (body: string) => {
        reply.body = body
      }
    }
    try {
      await (bridge as unknown as {
        handleNotebook: (path: string, body: Record<string, unknown>, res: unknown) => Promise<void>
      }).handleNotebook('/v1/notebook/variables', { workspaceRoot: '/ws' }, res)
      expect(reply.status).toBe(200)
      expect(JSON.parse(reply.body)).toMatchObject({
        status: 'done',
        result: { ok: true, variables: [{ name: 'acc' }] }
      })
    } finally {
      relay.shutdown()
    }
  })
})
