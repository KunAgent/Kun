import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ApprovalRequest } from '../../domain/approval.js'
import type { TurnItem } from '../../contracts/items.js'
import { AcpClientHost, type AcpClientContext } from './acp-client-host.js'
import type { AcpConnection } from './acp-connection.js'
import { ACP_CLIENT_METHODS, AcpError } from './acp-schema.js'

type Handler = (params: unknown, ctx: { id: number; method: string }) => unknown

function fakeConn(): { conn: AcpConnection; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const conn = {
    rpc: {
      onRequest: (method: string, handler: Handler) => {
        handlers.set(method, handler)
        return { onNotification: () => undefined }
      }
    }
  } as unknown as AcpConnection
  return { conn, handlers }
}

async function makeHarness(input: {
  approve?: (req: ApprovalRequest) => Promise<'allow' | 'deny'>
  spawnTerminal?: (cmd: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<import('node:child_process').ChildProcess>
  stopTerminal?: (child: import('node:child_process').ChildProcess) => Promise<void>
} = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'acp-host-')))
  const workspace = join(base, 'ws')
  const outside = join(base, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secret.txt'), 'outside-secret')
  await writeFile(join(workspace, 'inside.txt'), 'l1\nl2\nl3\nl4\n')

  const approvals: ApprovalRequest[] = []
  const recorded: TurnItem[] = []
  let checkpoints = 0
  let idSeq = 0
  const { conn, handlers } = fakeConn()
  const host = new AcpClientHost({
    spawnTerminal: input.spawnTerminal,
    stopTerminal: input.stopTerminal
  })
  host.attach(conn)
  const ctx: AcpClientContext = {
    sessionId: 'sess-1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace,
    readRoots: [workspace],
    writeRoots: [workspace],
    approve: async (req) => {
      approvals.push(req)
      return input.approve ? input.approve(req) : 'allow'
    },
    ensureCheckpoint: async () => {
      checkpoints += 1
    },
    recordChange: (item) => {
      recorded.push(item)
    },
    nextId: (p) => `${p}_${++idSeq}`
  }
  host.registerContext(ctx)
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    const handler = handlers.get(method)
    if (!handler) throw new Error(`no handler for ${method}`)
    return handler(params, { id: 1, method }) as Promise<T>
  }
  return { host, handlers, call, ctx, workspace, outside, approvals, recorded, checkpointCount: () => checkpoints }
}

describe('AcpClientHost', () => {
  test('reads outside the workspace — including symlink escapes — are denied', async () => {
    const h = await makeHarness()
    await symlink(h.outside, join(h.workspace, 'link-out'), 'dir')
    for (const path of [
      join(h.outside, 'secret.txt'),
      join(h.workspace, 'link-out', 'secret.txt'),
      '../outside/secret.txt'
    ]) {
      const error = await h
        .call(ACP_CLIENT_METHODS.fsReadTextFile, { sessionId: 'sess-1', path })
        .then(() => null)
        .catch((e: unknown) => e as AcpError)
      expect(error).toBeInstanceOf(AcpError)
      expect((error as AcpError).rpcCode).toBe(-32001)
    }
  })

  test('reads inside the workspace honor line/limit', async () => {
    const h = await makeHarness()
    const res = await h.call<{ content: string }>(ACP_CLIENT_METHODS.fsReadTextFile, {
      sessionId: 'sess-1',
      path: 'inside.txt',
      line: 2,
      limit: 2
    })
    expect(res.content).toBe('l2\nl3')
  })

  test('write requires approval; deny leaves the file untouched', async () => {
    const h = await makeHarness({ approve: async () => 'deny' })
    const target = join(h.workspace, 'denied.txt')
    const error = await h
      .call(ACP_CLIENT_METHODS.fsWriteTextFile, {
        sessionId: 'sess-1',
        path: 'denied.txt',
        content: 'nope'
      })
      .then(() => null)
      .catch((e: unknown) => e as AcpError)
    expect(error).toBeInstanceOf(AcpError)
    expect((error as AcpError).rpcCode).toBe(-32001)
    expect(h.approvals).toHaveLength(1)
    expect(h.approvals[0].toolName).toBe('acp:fs.write')
    expect(h.approvals[0].action?.kind).toBe('file')
    await expect(readFile(target, 'utf8')).rejects.toThrow()
    expect(h.checkpointCount()).toBe(0)
  })

  test('allowed write checkpoints, writes, and records a file_change pair', async () => {
    const h = await makeHarness({ approve: async () => 'allow' })
    await h.call(ACP_CLIENT_METHODS.fsWriteTextFile, {
      sessionId: 'sess-1',
      path: 'new.txt',
      content: 'hello'
    })
    expect(h.approvals).toHaveLength(1)
    expect(h.checkpointCount()).toBe(1)
    expect(await readFile(join(h.workspace, 'new.txt'), 'utf8')).toBe('hello')
    expect(h.recorded.map((i) => i.kind)).toEqual(['tool_call', 'tool_result'])
    const result = h.recorded[1] as { toolName: string; output: { diffs: unknown[] } }
    expect(result.toolName).toBe('acp:fs.write')
    expect(result.output.diffs).toEqual([
      { path: join(h.workspace, 'new.txt'), oldText: null, newText: 'hello' }
    ])
  })

  test('an allowed request_permission memoizes write targets — no second approval', async () => {
    const h = await makeHarness({ approve: async () => 'allow' })
    const outcome = await h.call<{ outcome: { outcome: string; optionId?: string } }>(
      ACP_CLIENT_METHODS.requestPermission,
      {
        sessionId: 'sess-1',
        toolCall: {
          toolCallId: 'call-1',
          kind: 'edit',
          title: 'Edit file',
          locations: [{ path: 'src/a.ts' }]
        },
        options: [
          { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Allow always', kind: 'allow_always' }
        ]
      }
    )
    expect(outcome.outcome).toEqual({ outcome: 'selected', optionId: 'once' })
    expect(h.approvals).toHaveLength(1)

    await h.call(ACP_CLIENT_METHODS.fsWriteTextFile, {
      sessionId: 'sess-1',
      path: 'src/a.ts',
      content: 'memoized'
    })
    // Same target — memo hit, no second approval.
    expect(h.approvals).toHaveLength(1)
    expect(await readFile(join(h.workspace, 'src/a.ts'), 'utf8')).toBe('memoized')

    await h.call(ACP_CLIENT_METHODS.fsWriteTextFile, {
      sessionId: 'sess-1',
      path: 'src/b.ts',
      content: 'new target'
    })
    expect(h.approvals).toHaveLength(2)
  })

  test('allow_always is only picked when it is the only allow option', async () => {
    const h = await makeHarness({ approve: async () => 'allow' })
    const outcome = await h.call<{ outcome: { outcome: string; optionId?: string } }>(
      ACP_CLIENT_METHODS.requestPermission,
      {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'c2', kind: 'execute', title: 'ls -la', rawInput: { command: 'ls -la' } },
        options: [{ optionId: 'always', name: 'Always', kind: 'allow_always' }]
      }
    )
    expect(outcome.outcome).toEqual({ outcome: 'selected', optionId: 'always' })
  })

  test('deny prefers reject_once and never fabricates allow options', async () => {
    const h = await makeHarness({ approve: async () => 'deny' })
    const outcome = await h.call<{ outcome: { outcome: string; optionId?: string } }>(
      ACP_CLIENT_METHODS.requestPermission,
      {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'c3', kind: 'fetch', title: 'Fetch https://x' },
        options: [
          { optionId: 'ro', name: 'Reject once', kind: 'reject_once' },
          { optionId: 'ra', name: 'Reject always', kind: 'reject_always' }
        ]
      }
    )
    expect(outcome.outcome).toEqual({ outcome: 'selected', optionId: 'ro' })
  })

  test('pending permission resolves cancelled when the session is cancelled', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = await makeHarness({
      approve: async () => {
        await gate
        return 'allow'
      }
    })
    const pendingCall = h.call<{ outcome: { outcome: string } }>(
      ACP_CLIENT_METHODS.requestPermission,
      {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'c4', kind: 'edit', title: 'Edit' },
        options: [{ optionId: 'o', name: 'Allow', kind: 'allow_once' }]
      }
    )
    await new Promise((r) => setTimeout(r, 10))
    h.host.cancelPendingPermissions('sess-1')
    const outcome = await pendingCall
    expect(outcome.outcome.outcome).toBe('cancelled')
    release?.()
  })

  test('terminal create enforces workspace cwd and output limits', async () => {
    const h = await makeHarness({
      approve: async () => 'allow',
      spawnTerminal: async (cmd, args, opts) =>
        spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }),
      stopTerminal: async (child) => {
        child.kill('SIGKILL')
      }
    })
    const created = await h.call<{ terminalId: string }>(ACP_CLIENT_METHODS.terminalCreate, {
      sessionId: 'sess-1',
      command: '/bin/sh',
      args: ['-c', 'printf "%0.sX" {1..2048}'],
      outputByteLimit: 16
    })
    await h.host.terminals.waitForExit(created.terminalId)
    const out = await h.call<{ output: string; truncated: boolean; exitStatus?: { exitCode: number | null } }>(
      ACP_CLIENT_METHODS.terminalOutput,
      { sessionId: 'sess-1', terminalId: created.terminalId }
    )
    expect(out.truncated).toBe(true)
    expect(out.output.length).toBeLessThanOrEqual(16)
    expect(out.exitStatus?.exitCode).toBe(0)
    // cwd outside the workspace is rejected before any spawn.
    const escape = await h
      .call(ACP_CLIENT_METHODS.terminalCreate, {
        sessionId: 'sess-1',
        command: 'true',
        cwd: h.outside
      })
      .then(() => null)
      .catch((e: unknown) => e as AcpError)
    expect((escape as AcpError).rpcCode).toBe(-32001)
    await h.host.turnEnded('turn_1')
  })

  test('turnEnded reclaims still-running terminal processes', async () => {
    const killed: number[] = []
    const h = await makeHarness({
      approve: async () => 'allow',
      spawnTerminal: async (cmd, args, opts) =>
        spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }),
      stopTerminal: async (child) => {
        if (child.pid) killed.push(child.pid)
        child.kill('SIGKILL')
      }
    })
    const created = await h.call<{ terminalId: string }>(ACP_CLIENT_METHODS.terminalCreate, {
      sessionId: 'sess-1',
      command: 'sleep',
      args: ['30']
    })
    expect(h.host.terminals.size).toBe(1)
    await h.host.turnEnded('turn_1')
    expect(h.host.terminals.size).toBe(0)
    expect(killed).toHaveLength(1)
    void created
  })

  test('client calls for an unknown/finished session fail closed', async () => {
    const h = await makeHarness()
    const error = await h
      .call(ACP_CLIENT_METHODS.fsReadTextFile, { sessionId: 'nope', path: 'x' })
      .then(() => null)
      .catch((e: unknown) => e as AcpError)
    expect((error as AcpError).rpcCode).toBe(-32002)
  })
})
