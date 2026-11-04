import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteFacade } from '../facade.js'
import {
  boundedCwd,
  registerTerminalOriginRoute,
  resolveTerminalOrigin,
  TERMINAL_ORIGIN_UNAVAILABLE
} from './origin-workspace.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const scopes = ['personal', 'desktop.view', 'desktop.control']

function body(kind: 'code' | 'agent', id: string, granted: string[] = scopes) {
  return {
    accountId: 'account-1',
    deviceId: 'phone-1',
    authorizationId: 'grant-1',
    scopes: granted,
    origin: { kind, id }
  }
}

async function fixture(options: {
  workspace?: string
  createWorkspace?: boolean
  thread?: Record<string, unknown>
  room?: { privateWorkspace?: string } | null
  agentId?: string
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-terminal-origin-'))
  roots.push(root)
  const workspace = options.workspace ?? join(root, 'project')
  if (options.createWorkspace !== false) await mkdir(workspace, { recursive: true })
  const agentId = options.agentId ?? 'agent-1'
  const room = options.room === null
    ? null
    : {
        id: 'room-1',
        conversationKind: 'user_agent' as const,
        ...(options.room?.privateWorkspace ? { privateWorkspace: options.room.privateWorkspace } : {}),
        members: [{ participantAgentId: agentId }]
      }
  const getMetadata = vi.fn(async (id: string) => id === 'thread-1'
    ? { id, workspace, workspaceMode: 'code', agentSurface: 'code', ...options.thread }
    : null)
  const runtime = {
    runtimeToken: 'token',
    insecure: false,
    rooms: {
      agents: { store: { list: async () => room ? [{ kind: 'room', id: 'room-1', revision: 0, seq: 0, value: room }] : [] } },
      deps: { dataDir: root }
    },
    threadService: { getMetadata }
  } as unknown as ServerRuntime
  const execute = vi.fn(async (_envelope: unknown) => ({ messages: [] }))
  return { root, workspace, agentId, runtime, execute, getMetadata }
}

describe('phone terminal origin workspace', () => {
  it('resolves an authorized Code thread to its real workspace directory', async () => {
    const f = await fixture()
    await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('code', 'thread-1')))
      .resolves.toEqual({ kind: 'code', id: 'thread-1', cwd: await realpath(f.workspace) })
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.execute.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'account-1', deviceId: 'phone-1', authorizationId: 'grant-1', scopes: ['personal'],
      call: { method: 'code.history', params: { threadId: 'thread-1' } }
    })
  })

  it('resolves an authorized agent conversation to the room workspace', async () => {
    const room = await mkdtemp(join(tmpdir(), 'kun-terminal-room-'))
    roots.push(room)
    const f = await fixture({ room: { privateWorkspace: room } })
    await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('agent', f.agentId)))
      .resolves.toEqual({ kind: 'agent', id: f.agentId, cwd: await realpath(room) })
    expect(f.execute.mock.calls[0]?.[0]).toMatchObject({
      call: { method: 'agent.history', params: { agentId: f.agentId } }
    })
  })

  it('creates only the host-owned default agent workspace', async () => {
    const f = await fixture()
    const expected = join(f.root, 'agents', 'workspaces', f.agentId)
    const resolved = await resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('agent', f.agentId))
    expect(resolved.cwd).toBe(await realpath(expected))
    expect((await stat(resolved.cwd)).isDirectory()).toBe(true)
    const absentRoot = await mkdtemp(join(tmpdir(), 'kun-terminal-absent-'))
    roots.push(absentRoot)
    const gone = await fixture({ room: { privateWorkspace: join(absentRoot, 'workspace') } })
    await expect(resolveTerminalOrigin(gone.runtime, { execute: gone.execute }, body('agent', gone.agentId)))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
  })

  it('refuses a workspace that is missing, not a directory, relative, or unbounded', async () => {
    const missing = await fixture({ createWorkspace: false })
    await expect(resolveTerminalOrigin(missing.runtime, { execute: missing.execute }, body('code', 'thread-1')))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
    const file = await fixture({ workspace: join(tmpdir(), 'kun-terminal-origin-file-' + process.pid + '.txt'), createWorkspace: false })
    roots.push(file.workspace)
    await writeFile(file.workspace, 'not a directory')
    await expect(resolveTerminalOrigin(file.runtime, { execute: file.execute }, body('code', 'thread-1')))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
    const relative = await fixture({ workspace: 'project', createWorkspace: false })
    await expect(resolveTerminalOrigin(relative.runtime, { execute: relative.execute }, body('code', 'thread-1')))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
    const long = await fixture({ workspace: '/' + 'a'.repeat(5_000), createWorkspace: false })
    await expect(resolveTerminalOrigin(long.runtime, { execute: long.execute }, body('code', 'thread-1')))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
  })

  it('returns the real path of a symlinked workspace', async () => {
    const f = await fixture()
    const link = join(f.root, 'project-link')
    await symlink(f.workspace, link, 'dir')
    const linked = await fixture({ workspace: link, createWorkspace: false })
    await expect(resolveTerminalOrigin(linked.runtime, { execute: linked.execute }, body('code', 'thread-1')))
      .resolves.toEqual({ kind: 'code', id: 'thread-1', cwd: await realpath(f.workspace) })
  })

  it('bounds absolute directories by UTF-8 bytes', () => {
    expect(boundedCwd('/' + '中'.repeat(1300))).toBe('/' + '中'.repeat(1300))
    for (const value of ['/' + '中'.repeat(1400), '/' + 'é'.repeat(2049), '/' + 'a'.repeat(4096)])
      expect(() => boundedCwd(value)).toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
  })

  it('reads no record when the authorized history call is rejected', async () => {
    const f = await fixture()
    const execute = vi.fn(async (_envelope: unknown) => { throw new Error('REMOTE_SCOPE_REQUIRED') })
    await expect(resolveTerminalOrigin(f.runtime, { execute }, body('code', 'thread-1')))
      .rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    expect(f.getMetadata).not.toHaveBeenCalled()
  })

  it('requires a terminal-capable grant before resolving anything', async () => {
    const f = await fixture()
    for (const granted of [['personal'], ['personal', 'desktop.view']]) {
      await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('code', 'thread-1', granted)))
        .rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    }
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.getMetadata).not.toHaveBeenCalled()
  })

  it('refuses a thread that is not a remote Code resource', async () => {
    const f = await fixture({ thread: { roomContext: { roomId: 'room-9' } } })
    await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('code', 'thread-1')))
      .rejects.toThrow('NOT_A_CODE_TASK')
  })

  it('refuses an unknown agent conversation without creating one', async () => {
    const f = await fixture({ room: null })
    await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, body('agent', 'agent-unknown')))
      .rejects.toThrow(TERMINAL_ORIGIN_UNAVAILABLE)
  })

  it('rejects a body that carries a client path or an unknown origin kind', async () => {
    const f = await fixture()
    const invalid = [
      { ...body('code', 'thread-1'), cwd: '/tmp' },
      { ...body('code', 'thread-1'), origin: { kind: 'code', id: '../etc' } },
      { ...body('code', 'thread-1'), origin: { kind: 'shell', id: 'thread-1' } },
      { accountId: 'account-1', origin: { kind: 'code', id: 'thread-1' } }
    ]
    for (const value of invalid) {
      await expect(resolveTerminalOrigin(f.runtime, { execute: f.execute }, value)).rejects.toThrow('INVALID_REQUEST')
    }
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('serves the origin over a runtime-token route and never echoes a path on failure', async () => {
    const f = await fixture()
    const router = new Router()
    registerTerminalOriginRoute(router, f.runtime, { execute: f.execute } as unknown as RemoteFacade)
    const route = router.match('POST', '/v1/remote/origin-workspace')!
    const post = (value: unknown, token?: string) => route.handler(new Request('http://local/v1/remote/origin-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(value)
    }), { params: {} })
    expect((await post(body('code', 'thread-1'))).status).toBe(401)
    const ok = await post(body('code', 'thread-1'), 'token')
    expect(ok.status).toBe(200)
    expect(ok instanceof Response ? await ok.json() : JSON.parse(ok.body)).toEqual({ kind: 'code', id: 'thread-1', cwd: await realpath(f.workspace) })
    const denied = await post({ ...body('code', 'thread-1'), cwd: '/tmp' }, 'token')
    expect(denied.status).toBe(403)
    expect(denied instanceof Response ? await denied.json() : JSON.parse(denied.body)).toEqual({ code: 'INVALID_REQUEST' })
    const noControl = await post(body('code', 'thread-1', ['personal']), 'token')
    expect(noControl.status).toBe(403)
    expect(noControl instanceof Response ? await noControl.json() : JSON.parse(noControl.body)).toEqual({ code: 'REMOTE_SCOPE_REQUIRED' })
  })
})
