import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLAB_NOTEBOOK_MARKER, type ColabNotebookExecEvent, type ColabNotebookOutput } from '../../shared/colab/colab-notebook-types'
import type { ColabCredentialStore } from './colab-credential-store'
import {
  buildDriveReadFilePython,
  ColabDriveNotebookManager,
  parseDriveMarkerLines
} from './colab-drive-notebooks'
import { extractNotebookAssistCell } from './colab-notebook-assist'
import {
  buildKernelVariablesPython,
  buildNotebookCellPython,
  buildRemoteListPython,
  createNotebookOutputParser,
  parseKernelVariablesOutput,
  parseRemoteListOutput
} from './colab-notebook-kernel'
import { isJupyterSessionId, JupyterServerManager } from './jupyter-server-manager'
import { encodeJupyterPath, parseJupyterServerUrl, type JupyterSocketLike } from './jupyter-server-protocol'

describe('colab notebook kernel protocol', () => {
  it('splits stream text from image and error markers across chunk boundaries', () => {
    const outputs: ColabNotebookOutput[] = []
    const parser = createNotebookOutputParser((o) => outputs.push(o))
    parser.push('hello\n' + COLAB_NOTEBOOK_MARKER.slice(0, 3), 'stdout')
    parser.push(COLAB_NOTEBOOK_MARKER.slice(3) + 'IMG:QUJD\n', 'stdout')
    parser.push(COLAB_NOTEBOOK_MARKER + 'ERR:{"ename":"KeyError","evalue":"x","traceback":"tb"}\n', 'stdout')
    parser.push('warn', 'stderr')
    parser.flush()
    expect(outputs).toEqual([
      { type: 'stream', name: 'stdout', text: 'hello\n' },
      { type: 'image', mime: 'image/png', data: 'QUJD' },
      { type: 'error', ename: 'KeyError', evalue: 'x', traceback: 'tb' },
      { type: 'stream', name: 'stderr', text: 'warn' }
    ])
  })

  it('emits progress-bar partial lines immediately', () => {
    const outputs: ColabNotebookOutput[] = []
    const parser = createNotebookOutputParser((o) => outputs.push(o))
    parser.push('step 1\r', 'stdout')
    expect(outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'step 1\r' }])
  })

  it('embeds user code as base64 so quotes and newlines cannot break the wrapper', () => {
    const source = 'print("a\'b")\n"""x"""'
    const py = buildNotebookCellPython(source)
    expect(py).toContain(Buffer.from(source, 'utf8').toString('base64'))
    expect(py).not.toContain(source)
    expect(py).toContain('/root/.kun-colab/heartbeat')
    expect(buildRemoteListPython("/content/it's")).toContain(Buffer.from("/content/it's").toString('base64'))
  })

  it('parses remote listings, kernel variables, and Drive markers', () => {
    const entries = [{ name: 'a', path: '/content/a', isDir: true, size: 0 }]
    expect(parseRemoteListOutput(`noise\n${COLAB_NOTEBOOK_MARKER}LS:${JSON.stringify(entries)}\n`)).toEqual(entries)
    expect(parseRemoteListOutput(`${COLAB_NOTEBOOK_MARKER}LSERR:"No such file"`)).toEqual({ error: 'No such file' })
    expect(parseRemoteListOutput('nothing')).toBeNull()

    expect(buildKernelVariablesPython()).toContain('VARS:')
    const vars = [{ name: 'model', typeName: 'ResNet', summary: '' }]
    expect(parseKernelVariablesOutput(`log\n${COLAB_NOTEBOOK_MARKER}VARS:${JSON.stringify(vars)}\n`)).toEqual(vars)

    const driveEntries = [
      {
        name: 'exp.ipynb',
        remotePath: '/content/drive/MyDrive/Colab Notebooks/exp.ipynb',
        relativePath: 'Colab Notebooks/exp.ipynb',
        sizeBytes: 512,
        modifiedAtMs: 1700000000000
      }
    ]
    expect(parseDriveMarkerLines(`${COLAB_NOTEBOOK_MARKER}DRV_LIST:${JSON.stringify(driveEntries)}`)).toEqual({
      kind: 'list',
      entries: driveEntries
    })
    expect(parseDriveMarkerLines(`${COLAB_NOTEBOOK_MARKER}DRV_AUTH:{"uri":"https://accounts.google.com/o"}`)).toEqual({
      kind: 'auth',
      uri: 'https://accounts.google.com/o'
    })
    expect(buildDriveReadFilePython('/content/drive/MyDrive/a.ipynb')).toContain(
      Buffer.from('/content/drive/MyDrive/a.ipynb', 'utf8').toString('base64')
    )
  })

  it('imports external local .ipynb files into workspace without colliding names', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kun-nb-import-'))
    try {
      const wsDir = join(tmp, 'ws')
      await mkdir(wsDir)
      const extFile = join(tmp, 'train_v1.ipynb')
      await writeFile(extFile, JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
      const mgr = new ColabDriveNotebookManager({} as never, async () => undefined)
      const res = await mgr.importLocalNotebooks({ workspaceRoot: wsDir, localPaths: [extFile] })
      expect(res).toEqual({ ok: true, relativePaths: ['train_v1.ipynb'] })
      const raw = JSON.parse(await readFile(join(wsDir, 'train_v1.ipynb'), 'utf8')) as { nbformat: number }
      expect(raw.nbformat).toBe(4)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('extracts python and markdown cells from fenced or raw model outputs', () => {
    expect(extractNotebookAssistCell('```python\nimport torch\nprint(1)\n```')).toEqual({
      kind: 'code',
      source: 'import torch\nprint(1)'
    })
    expect(extractNotebookAssistCell('```markdown\n## Summary\nDone.\n```')).toEqual({
      kind: 'markdown',
      source: '## Summary\nDone.'
    })
    expect(extractNotebookAssistCell('x = 42')).toEqual({ kind: 'code', source: 'x = 42' })
    expect(extractNotebookAssistCell('   ')).toBeNull()
  })
})

describe('Jupyter server protocol and manager', () => {
  it('normalizes pasted JupyterLab / JupyterHub URLs and extracts query tokens', () => {
    expect(parseJupyterServerUrl('http://127.0.0.1:8888/lab/tree/work.ipynb?token=abc123')).toEqual({
      baseUrl: 'http://127.0.0.1:8888',
      secret: 'abc123',
      defaultName: '127.0.0.1:8888'
    })
    expect(parseJupyterServerUrl('https://hub.example.com/user/alice/lab?token=xyz', 'override')).toEqual({
      baseUrl: 'https://hub.example.com/user/alice',
      secret: 'override',
      defaultName: 'hub.example.com'
    })
    expect(parseJupyterServerUrl('localhost:8889')).toEqual({
      baseUrl: 'http://localhost:8889',
      secret: '',
      defaultName: 'localhost:8889'
    })
    expect(encodeJupyterPath('/folder a/my nb.ipynb')).toBe('folder%20a/my%20nb.ipynb')
  })

  it('connects to a Jupyter server, runs kernel code over WebSocket, lists variables, and imports remote notebooks', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kun-jpy-test-'))
    const wsDir = join(tmp, 'workspace')
    await mkdir(wsDir)
    const memTokens = new Map<string, { token: string }>()
    const fakeCreds = {
      readToken: async (id: string) => memTokens.get(id) ?? null,
      writeToken: async (id: string, payload: { token: string }) => {
        memTokens.set(id, payload)
      },
      removeConnection: async (id: string) => {
        memTokens.delete(id)
      }
    } as unknown as ColabCredentialStore

    const jsonResp = (status: number, body: unknown): Response =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })

    let kernelStarts = 0
    const fakeFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'token secret-tok') {
        return jsonResp(403, { message: 'Forbidden' })
      }
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'GET' && url.pathname === '/api/kernelspecs') {
        return jsonResp(200, { default: 'python3', kernelspecs: { python3: {}, ir: {} } })
      }
      if (method === 'POST' && url.pathname === '/api/kernels') {
        kernelStarts += 1
        return jsonResp(201, { id: 'kernel-42', name: 'python3' })
      }
      if (method === 'DELETE' && url.pathname === '/api/kernels/kernel-42') {
        return new Response(null, { status: 204 })
      }
      if (method === 'GET' && url.pathname === '/api/contents') {
        return jsonResp(200, {
          type: 'directory',
          content: [
            {
              name: 'demo.ipynb',
              path: 'demo.ipynb',
              type: 'notebook',
              size: 256,
              last_modified: '2026-11-18T10:00:00Z'
            }
          ]
        })
      }
      if (method === 'GET' && url.pathname === '/api/contents/demo.ipynb') {
        return jsonResp(200, {
          name: 'demo.ipynb',
          path: 'demo.ipynb',
          type: 'notebook',
          format: 'json',
          content: {
            cells: [{ cell_type: 'code', metadata: {}, source: ['print(42)\n'], outputs: [], execution_count: 1 }],
            metadata: {},
            nbformat: 4,
            nbformat_minor: 5
          }
        })
      }
      return jsonResp(404, { message: 'Not found' })
    }

    const createWebSocket = (
      _url: string,
      opts: { headers: Record<string, string> }
    ): JupyterSocketLike => {
      const emitter = new EventEmitter()
      queueMicrotask(() => {
        if (opts.headers.Authorization !== 'token secret-tok') {
          emitter.emit('error', new Error('Unauthorized'))
          return
        }
        emitter.emit('open')
      })
      return {
        once: (ev, fn) => {
          emitter.once(ev, fn)
        },
        on: (ev, fn) => {
          emitter.on(ev, fn)
        },
        close: () => {
          emitter.emit('close')
        },
        send: (raw) => {
          const msg = JSON.parse(raw) as {
            header: { msg_id: string }
            content: { code: string; store_history: boolean }
          }
          const parent_header = { msg_id: msg.header.msg_id }
          queueMicrotask(() => {
            if (msg.content.code.includes('VARS:')) {
              expect(msg.content.store_history).toBe(false)
              const line = `${COLAB_NOTEBOOK_MARKER}VARS:${JSON.stringify([{ name: 'acc', typeName: 'float', summary: '0.92' }])}\n`
              emitter.emit('message', JSON.stringify({ msg_type: 'stream', parent_header, content: { name: 'stdout', text: line } }))
            } else {
              emitter.emit('message', JSON.stringify({ msg_type: 'stream', parent_header, content: { name: 'stdout', text: 'stale bar\n' } }))
              emitter.emit('message', JSON.stringify({ msg_type: 'clear_output', parent_header, content: { wait: true } }))
              emitter.emit('message', JSON.stringify({ msg_type: 'stream', parent_header, content: { name: 'stdout', text: 'hello jupyter\n' } }))
              emitter.emit('message', JSON.stringify({ msg_type: 'update_display_data', parent_header, content: { data: { 'image/png': ['QU', 'JD'] } } }))
            }
            emitter.emit('message', JSON.stringify({ msg_type: 'execute_reply', parent_header, content: { status: 'ok' } }))
            emitter.emit('message', JSON.stringify({ msg_type: 'status', parent_header, content: { execution_state: 'idle' } }))
          })
        }
      }
    }

    try {
      const events: ColabNotebookExecEvent[] = []
      let resolveDone!: (ev: ColabNotebookExecEvent) => void
      const execFinished = new Promise<ColabNotebookExecEvent>((r) => {
        resolveDone = r
      })

      const openedUrls: string[] = []
      const manager = new JupyterServerManager({
        colabRootDir: join(tmp, 'colab-state'),
        credentials: fakeCreds,
        fetchImpl: fakeFetch,
        createWebSocket,
        openExternal: async (url) => {
          openedUrls.push(url)
        },
        emitNotebookEvent: (ev) => {
          events.push(ev)
          if (ev.kind === 'done') resolveDone(ev)
        }
      })

      const saved = await manager.saveServer({
        url: 'http://127.0.0.1:8888/lab?token=secret-tok', name: 'Local Lab'
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.server.baseUrl).toBe('http://127.0.0.1:8888')
      const notebooks = await manager.listNotebooks({ serverId: saved.server.id })
      expect(notebooks.ok && notebooks.status === 'ready' ? notebooks.entries.map((e) => e.name) : []).toEqual(['demo.ipynb'])
      const imported = await manager.importNotebook({
        serverId: saved.server.id, remotePath: '/demo.ipynb', workspaceRoot: wsDir
      })
      expect(imported).toEqual({ ok: true, file: { remotePath: '/demo.ipynb', relativePath: 'demo.ipynb', disposition: 'created' } })
      expect(kernelStarts).toBe(0)
      expect((await manager.getSnapshot()).sessions).toEqual([])

      const connected = await manager.connect({ workspaceRoot: wsDir, serverId: saved.server.id })
      expect(kernelStarts).toBe(1)
      expect(connected.ok).toBe(true)
      if (!connected.ok) return
      expect(isJupyterSessionId(connected.session.id)).toBe(true)
      expect(connected.server.authMode).toBe('token')
      expect(connected.server.availableKernels).toEqual(['python3', 'ir'])
      await manager.openBrowser(connected.server.id)
      expect(openedUrls).toEqual(['http://127.0.0.1:8888/lab?token=secret-tok'])

      const files = await manager.listFiles({ sessionId: connected.session.id, path: '/' })
      expect(files).toEqual({
        ok: true,
        path: '/',
        entries: [{ name: 'demo.ipynb', path: '/demo.ipynb', isDir: false, size: 256 }]
      })

      const vars = await manager.listVariables({ sessionId: connected.session.id })
      expect(vars).toEqual({ ok: true, variables: [{ name: 'acc', typeName: 'float', summary: '0.92' }] })

      const started = await manager.execute({
        sessionId: connected.session.id,
        execId: 'exec-1',
        code: 'print("hello jupyter")'
      })
      expect(started).toEqual({ ok: true })
      const finalEvent = await execFinished
      expect(finalEvent).toEqual({ execId: 'exec-1', kind: 'done', ok: true, interrupted: false, message: undefined })
      expect(events).toContainEqual({ execId: 'exec-1', kind: 'clear' })
      expect(events).toContainEqual({
        execId: 'exec-1',
        kind: 'output',
        output: { type: 'stream', name: 'stdout', text: 'hello jupyter\n' }
      })
      expect(events).toContainEqual({
        execId: 'exec-1',
        kind: 'output',
        output: { type: 'image', mime: 'image/png', data: 'QUJD' }
      })

      await manager.shutdown()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('authenticates via /login password exchange and omits ?token= when opening browser', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kun-jpy-pwd-'))
    const memTokens = new Map<string, { token: string }>()
    const fakeCreds = {
      readToken: async (id: string) => memTokens.get(id) ?? null,
      writeToken: async (id: string, payload: { token: string }) => {
        memTokens.set(id, payload)
      },
      removeConnection: async (id: string) => {
        memTokens.delete(id)
      }
    } as unknown as ColabCredentialStore

    const passwordFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const headers = new Headers(init?.headers)
      const method = (init?.method || 'GET').toUpperCase()
      if (url.pathname === '/login' && method === 'GET') {
        return new Response('', {
          status: 200,
          headers: { 'set-cookie': '_xsrf=xsrf123; Path=/' }
        })
      }
      if (url.pathname === '/login' && method === 'POST') {
        return new Response('', {
          status: 302,
          headers: { 'set-cookie': 'jupyter-session=sess-abc; Path=/' }
        })
      }
      const hasSessionCookie = (headers.get('cookie') ?? '').includes('jupyter-session=sess-abc')
      if (!hasSessionCookie) {
        return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })
      }
      if (url.pathname === '/api/kernelspecs') {
        return new Response(JSON.stringify({ default: 'python3', kernelspecs: { python3: {} } }), { status: 200 })
      }
      if (url.pathname === '/api/kernels' && method === 'POST') {
        return new Response(JSON.stringify({ id: 'k-pwd', name: 'python3' }), { status: 201 })
      }
      if (url.pathname === '/api/kernels/k-pwd' && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    }

    const openedUrls: string[] = []
    const manager = new JupyterServerManager({
      colabRootDir: join(tmp, 'colab-state'),
      credentials: fakeCreds,
      fetchImpl: passwordFetch,
      openExternal: async (url) => {
        openedUrls.push(url)
      },
      emitNotebookEvent: () => undefined
    })

    try {
      const connected = await manager.connect({
        workspaceRoot: join(tmp, 'ws'),
        url: 'https://jupyter.example.com',
        tokenOrPassword: 'my-secret-password'
      })
      expect(connected.ok).toBe(true)
      if (!connected.ok) return
      expect(connected.server.authMode).toBe('password')
      await manager.openBrowser(connected.server.id)
      expect(openedUrls).toEqual(['https://jupyter.example.com/lab'])
      await manager.shutdown()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
