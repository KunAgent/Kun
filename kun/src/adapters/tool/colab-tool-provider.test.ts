import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { buildColabToolProviders } from './colab-tool-provider.js'

describe('buildColabToolProviders', () => {
  it('returns empty providers when no GUI bridge binding is configured', () => {
    expect(buildColabToolProviders({ binding: null })).toEqual([])
  })

  it('advertises colab tools only on GUI clientSurface and executes status + approval preview', async () => {
    const server = createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer secret-token') {
        res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      if (req.url === '/v1/colab/preview') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            requireApprovalForAgent: true,
            connection: { name: '个人', email: 'zxy@gmail.com', balanceCu: 86.4 },
            acceleratorSpec: { estimatedCuPerHour: 4.8 }
          })
        )
        return
      }
      if (req.url === '/v1/colab/status') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            cli: { state: 'ready', version: '0.8.0' },
            connections: [{ id: 'c1', name: '个人', balanceCu: 86.4 }],
            sessions: []
          })
        )
        return
      }
      res.writeHead(404).end('{}')
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    try {
      const providers = buildColabToolProviders({
        binding: { url: `http://127.0.0.1:${port}`, token: 'secret-token' }
      })
      expect(providers).toHaveLength(1)
      const tools = providers[0]!.tools
      expect(tools.map((t) => t.name)).toEqual(['colab_status', 'colab_run', 'colab_stop'])

      const guiCtx = { workspace: '/tmp/ws', clientSurface: 'gui' } as any
      const tuiCtx = { workspace: '/tmp/ws', clientSurface: 'tui' } as any
      expect(tools[0]!.shouldAdvertise?.(guiCtx)).toBe(true)
      expect(tools[0]!.shouldAdvertise?.(tuiCtx)).toBe(false)

      const statusRes = await tools[0]!.execute({}, guiCtx)
      expect(statusRes.isError).toBeUndefined()
      expect((statusRes.output as any).connections[0].balanceCu).toBe(86.4)

      const approval = await tools[1]!.buildApprovalAction?.(
        {
          callId: 'call-1',
          toolName: 'colab_run',
          arguments: { entryCommand: 'python train.py', accelerator: 'L4', maxRuntimeHours: 2 }
        },
        guiCtx
      )
      expect(approval?.toolName).toBe('colab_run')
      expect(approval?.requiresUserDecision).toBe(true)
      expect(approval?.reason).toContain('zxy@gmail.com')
      expect(approval?.reason).toContain('9.6 CU')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
