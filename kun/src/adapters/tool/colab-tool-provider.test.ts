import { describe, expect, it } from 'vitest'
import { buildColabToolProviders } from './colab-tool-provider.js'

const jsonResp = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('buildColabToolProviders', () => {
  it('returns empty providers when no GUI bridge binding is configured', () => {
    expect(buildColabToolProviders({ binding: null })).toEqual([])
  })

  it('advertises colab tools only on GUI clientSurface, enforces bearer auth, and executes status + approval preview', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer secret-token') {
        return jsonResp(401, { error: 'unauthorized' })
      }
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname === '/v1/colab/preview') {
        return jsonResp(200, {
          requireApprovalForAgent: true,
          connection: { name: '个人', email: 'zxy@gmail.com', balanceCu: 86.4 },
          acceleratorSpec: { estimatedCuPerHour: 4.8 }
        })
      }
      if (url.pathname === '/v1/colab/status') {
        return jsonResp(200, {
          cli: { state: 'ready', version: '0.8.0' },
          connections: [{ id: 'c1', name: '个人', balanceCu: 86.4 }],
          sessions: []
        })
      }
      return jsonResp(404, {})
    }

    const providers = buildColabToolProviders({
      binding: { url: 'http://127.0.0.1:41234', token: 'secret-token', fetchImpl }
    })
    expect(providers).toHaveLength(1)
    const tools = providers[0]!.tools
    expect(tools.map((t) => t.name)).toEqual([
      'colab_status',
      'colab_run',
      'colab_stop',
      'notebook_run_cells',
      'notebook_variables'
    ])

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

    const unauthorizedTools = buildColabToolProviders({
      binding: { url: 'http://127.0.0.1:41234', token: 'wrong-token', fetchImpl }
    })[0]!.tools
    const unauthRes = await unauthorizedTools[0]!.execute({}, guiCtx)
    expect(unauthRes.isError).toBe(true)
    expect((unauthRes.output as any).error).toContain('unauthorized')
  })

  it('long-polls notebook_run_cells until the GUI notebook page returns cell results', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer t') {
        return jsonResp(401, { error: 'unauthorized' })
      }
      const pathname = new URL(typeof input === 'string' ? input : input.toString()).pathname
      calls.push(pathname)
      if (pathname === '/v1/notebook/run') {
        return jsonResp(200, { status: 'running', requestId: 'r1' })
      }
      if (pathname === '/v1/notebook/result') {
        return jsonResp(200, {
          status: 'done',
          requestId: 'r1',
          result: {
            ok: true,
            notebookPath: 'eval.ipynb',
            cells: [{ number: 2, kind: 'code', status: 'ok', executionCount: 3, output: 'acc 0.91' }]
          }
        })
      }
      return jsonResp(200, {
        status: 'done',
        requestId: 'v1',
        result: { ok: false, message: 'No notebook runtime is connected.' }
      })
    }

    const tools = buildColabToolProviders({
      binding: { url: 'http://127.0.0.1:41234', token: 't', fetchImpl }
    })[0]!.tools
    const runTool = tools.find((t) => t.name === 'notebook_run_cells')!
    const varsTool = tools.find((t) => t.name === 'notebook_variables')!
    const ctx = { workspace: '/tmp/ws', clientSurface: 'gui' } as any
    expect(runTool.policy).toBe('on-request')
    expect(varsTool.sideEffect).toBe('read-only')

    const runRes = await runTool.execute({ cells: [2] }, ctx)
    expect(runRes.isError).toBeUndefined()
    expect((runRes.output as any).cells[0].output).toBe('acc 0.91')
    expect(calls).toEqual(['/v1/notebook/run', '/v1/notebook/result'])

    const varsRes = await varsTool.execute({}, ctx)
    expect(varsRes.isError).toBe(true)
    expect((varsRes.output as any).error).toContain('No notebook runtime')
  })
})
