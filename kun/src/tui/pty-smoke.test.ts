import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSharedRuntime, stopSharedRuntime } from '../cli/shared-runtime.js'
import { resolveServiceManager } from '../manager/manager-client.js'
import { readManagerDiscovery } from '../manager/manager-discovery.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import { startKunServe, type KunServeHandle } from '../server/runtime-factory.js'
import {
  testGraphConfig,
  testGraphPlan
} from '../graph/graph-test-fixtures.test-support.js'
import { KunTuiClient } from './client.js'
import { sanitizeTerminalText } from './layout.js'

const worktreeRoot = resolve(import.meta.dirname, '../../..')
const cliEntry = join(worktreeRoot, 'kun/dist/cli/serve-entry.js')
const roots: string[] = []
const servers: KunServeHandle[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(roots.map((root) => stopSharedRuntime(root).catch(() => false)))
  await Promise.all(roots.map((root) => stopIsolatedManager(join(root, 'control'))))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32' || !existsSync(cliEntry))('kun tui PTY smoke', () => {
  it('starts, creates and opens a thread, accepts input and resize, interrupts, and restores the terminal on exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-pty-'))
    roots.push(root)
    const runtimeToken = 'pty-runtime-token'
    const buildId = await readRuntimeBuildIdForEntry(cliEntry)
    const server = await startKunServe({
      host: '127.0.0.1',
      port: 0,
      dataDir: root,
      runtimeToken,
      apiKey: 'pty-test-key',
      baseUrl: 'http://127.0.0.1:9',
      model: 'gpt-5.6-luna',
      models: {
        profiles: {
          'gpt-5.6-luna': {
            contextWindowTokens: 372_000
          }
        }
      },
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      ...(buildId ? { buildId } : {})
    })
    servers.push(server)
    const client = new KunTuiClient({
      baseUrl: `http://${server.host}:${server.port}`,
      runtimeToken
    })

    const terminal = pty.spawn(process.execPath, [
      cliEntry,
      'tui',
      '--data-dir', root,
      '--workspace', root
    ], {
      name: 'xterm-256color',
      cols: 88,
      rows: 26,
      cwd: worktreeRoot,
      env: stringEnvironment({
        ...process.env,
        KUN_MANAGER_CONTROL_DIR: join(root, 'control'),
        KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
      })
    })
    let output = ''
    const dataSubscription = terminal.onData((data) => { output += data })
    const exited = new Promise<{ exitCode: number; signal?: number }>((accept) => {
      terminal.onExit(accept)
    })

    try {
      await waitFor(() =>
        output.includes('Welcome to Kun') &&
        output.includes('/connect') &&
        output.includes('/sessions') &&
        output.includes('┌') &&
        output.includes('Ctrl+P')
      )
      expect(output).not.toContain('\x1b[?1049h')
      expect(output).toContain('/connect')
      expect(output).toContain('/sessions')
      expect(output).toContain('Workspace')
      expect(output).toContain('┌')
      expect(output).toContain('Ctrl+P')
      expect(output).not.toContain('/model')
      expect(output).not.toContain('runtime ready')
      expect(output).not.toContain('MCP ')
      expect(output).not.toContain('No threads found')

      await waitFor(() => sanitizeTerminalText(output).includes('gpt-5.6-luna · high'))
      terminal.write('\x14') // Ctrl+T cycles high -> max.
      await waitFor(() => output.includes('Reasoning effort: max'))
      await waitFor(() => sanitizeTerminalText(output).includes('gpt-5.6-luna · max'))

      terminal.write('\x18n') // Ctrl+X N
      const thread = await waitForValue(async () =>
        (await client.listThreads()).find((item) => item.title === 'Terminal chat')
      ).catch((error) => {
        const visibleTail = sanitizeTerminalText(output).slice(-2_000)
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nPTY output tail:\n${visibleTail}`)
      })
      await waitFor(() => output.includes('Terminal chat'))

      terminal.write('/rename PTY smoke\r')
      await waitFor(async () => (await client.getThread(thread.id)).title === 'PTY smoke')

      const beforeResize = output.length
      terminal.resize(52, 14)
      await waitFor(() => output.length > beforeResize)
      const beforeWideResize = output.length
      terminal.resize(112, 26)
      await waitFor(() => output.length > beforeWideResize)

      const turn = await server.runtime.turnService.startTurn({
        threadId: thread.id,
        request: { prompt: 'hold for interrupt', model: 'gpt-5.6-luna', mode: 'agent' }
      })
      await waitFor(() => {
        const visible = sanitizeTerminalText(output)
        return visible.includes('Esc stop') && visible.includes('Waiting')
      })
      expect(sanitizeTerminalText(output)).not.toContain('Tip:')
      const itemBase = {
        id: 'item_pty_stream', threadId: thread.id, turnId: turn.turnId, role: 'assistant' as const,
        status: 'running' as const, createdAt: new Date().toISOString(), kind: 'assistant_text' as const
      }
      const reasoningBase = {
        ...itemBase,
        id: 'item_pty_reasoning',
        kind: 'assistant_reasoning' as const
      }
      await server.runtime.events.record({
        kind: 'assistant_reasoning_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: reasoningBase.id, item: { ...reasoningBase, text: 'Inspect the active model capability.' }
      })
      await waitFor(() => output.includes('/thinking expand'))
      expect(output).not.toContain('Inspect the active model capability.')
      expect(output).not.toContain('\x1b[?1000h\x1b[?1006h')
      expect(sanitizeTerminalText(output)).toContain('History')

      terminal.write('\x18p') // Ctrl+X P opts into direct transcript clicks.
      await waitFor(() =>
        output.includes('Mouse clicks enabled') &&
        output.includes('\x1b[?1000h\x1b[?1006h')
      )
      terminal.write('\x18p') // The same binding restores native scroll and selection.
      await waitFor(() =>
        output.includes('Text selection mode') &&
        output.lastIndexOf('\x1b[?1000l\x1b[?1006l') >
          output.lastIndexOf('\x1b[?1000h\x1b[?1006h')
      )
      expect((await client.getThread(thread.id)).turns.find((candidate) => candidate.id === turn.turnId)?.status).toBe('running')

      terminal.write('/thinking\r')
      await waitFor(() => output.includes('Thinking is expanded'))
      await waitFor(() => output.includes('Inspect the active model capability.'))
      terminal.write('/thinking\r')
      await waitFor(() => output.includes('Thinking is collapsed'))
      const beforeHiddenReasoning = output.length
      await server.runtime.events.record({
        kind: 'assistant_reasoning_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: reasoningBase.id, item: { ...reasoningBase, text: ' This fragment stays hidden.' }
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(output.slice(beforeHiddenReasoning)).not.toContain('This fragment stays hidden.')
      terminal.write('/thinking\r')
      await waitFor(() => output.slice(beforeHiddenReasoning).includes('Thinking is expanded'))

      const beforeAssistantDelta = output.length
      await server.runtime.events.record({
        kind: 'assistant_text_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: itemBase.id, item: { ...itemBase, text: 'Hel' }
      })
      await waitFor(() =>
        output.slice(beforeAssistantDelta).includes('Hel') &&
        output.slice(beforeAssistantDelta).includes('Responding')
      )
      expect(output).toContain('▍')
      expect((await client.getThread(thread.id)).turns.find((candidate) => candidate.id === turn.turnId)?.status).toBe('running')
      await server.runtime.events.record({
        kind: 'assistant_text_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: itemBase.id, item: { ...itemBase, text: 'lo' }
      })
      await waitFor(() => output.includes('Hello'))

      terminal.write('\x1b') // Escape interrupts the active turn
      await waitFor(async () => {
        const detail = await client.getThread(thread.id)
        return detail.turns.find((candidate) => candidate.id === turn.turnId)?.status === 'aborted'
      })

      terminal.write('/quit\r')
      const exit = await withTimeout(exited, 5_000, 'PTY process did not exit')
      expect(exit.exitCode).toBe(0)
      expect(output).toContain('\x1b[?2004l')
      expect(output).not.toContain('\x1b[?1049l')
      expect(output).not.toContain('\x1b[3J')
    } finally {
      dataSubscription.dispose()
      try { terminal.kill() } catch { /* already exited */ }
    }
  }, 30_000)

  it('starts its own shared runtime and leaves it alive after the standalone TUI exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-standalone-'))
    roots.push(root)
    const controlDir = join(root, 'control')
    const terminal = pty.spawn(process.execPath, [
      cliEntry,
      '--data-dir', root,
      '--workspace', root
    ], {
      name: 'xterm-256color',
      cols: 88,
      rows: 26,
      cwd: worktreeRoot,
      env: stringEnvironment({
        ...process.env,
        KUN_MANAGER_CONTROL_DIR: controlDir,
        KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
      })
    })
    let output = ''
    let exitState: { exitCode: number; signal?: number } | undefined
    const dataSubscription = terminal.onData((data) => { output += data })
    const exited = new Promise<{ exitCode: number; signal?: number }>((accept) => {
      terminal.onExit((state) => {
        exitState = state
        accept(state)
      })
    })

    try {
      const manager = await waitForPtyValue(
        async () => (await resolveServiceManager(controlDir)) ?? undefined,
        {
          stage: 'Service Manager readiness',
          timeoutMs: 35_000,
          getExit: () => exitState,
          getOutput: () => output
        }
      )
      const connection = await waitForPtyValue(
        async () => (await resolveSharedRuntime(root, fetch, { manager, controlDir })) ?? undefined,
        {
          stage: 'shared Runtime readiness',
          timeoutMs: 35_000,
          getExit: () => exitState,
          getOutput: () => output
        }
      )
      expect(connection.discovery.launchMode).toBe('shared')
      await waitForPtyValue(
        () => output.includes('Welcome to Kun') &&
          output.includes('/connect') &&
          output.includes('/sessions')
          ? true
          : undefined,
        {
          stage: 'TUI first render',
          timeoutMs: 10_000,
          getExit: () => exitState,
          getOutput: () => output
        }
      )

      terminal.write('\x03')
      await new Promise((resolve) => setTimeout(resolve, 80))
      terminal.write('\x03')
      const exit = await withTimeout(exited, 5_000, 'standalone TUI process did not exit')
      expect(exit.exitCode).toBe(0)
      expect(output).not.toContain('\x1b[?1049h')
      expect(output).not.toContain('\x1b[?1049l')
      expect(await resolveSharedRuntime(root)).not.toBeNull()

      expect(await stopSharedRuntime(root)).toBe(true)
      expect(await resolveSharedRuntime(root)).toBeNull()
    } finally {
      dataSubscription.dispose()
      try { terminal.kill() } catch { /* already exited */ }
    }
  }, 90_000)

  it('submits --graph after startup and opens a narrow Graph board through opt-in mouse input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-graph-pty-'))
    roots.push(root)
    const runtimeToken = 'pty-graph-runtime-token'
    const buildId = await readRuntimeBuildIdForEntry(cliEntry)
    const server = await startKunServe({
      host: '127.0.0.1',
      port: 0,
      dataDir: root,
      runtimeToken,
      apiKey: 'pty-graph-test-key',
      baseUrl: 'http://127.0.0.1:9',
      model: 'gpt-5.6-luna',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      graph: testGraphConfig(),
      ...(buildId ? { buildId } : {})
    })
    servers.push(server)
    const client = new KunTuiClient({
      baseUrl: `http://${server.host}:${server.port}`,
      runtimeToken
    })
    const requirement = 'Build the PTY Graph board'
    const terminal = pty.spawn(process.execPath, [
      cliEntry,
      '--data-dir', root,
      '--workspace', root,
      '--graph', requirement
    ], {
      name: 'xterm-256color',
      cols: 88,
      rows: 26,
      cwd: worktreeRoot,
      env: stringEnvironment(process.env)
    })
    let output = ''
    const dataSubscription = terminal.onData((data) => { output += data })
    const exited = new Promise<{ exitCode: number; signal?: number }>((accept) => {
      terminal.onExit(accept)
    })

    try {
      const source = await waitForValue(async () => {
        const thread = (await client.listThreads())[0]
        if (!thread) return undefined
        const detail = await client.getThread(thread.id)
        const turn = detail.turns.find((candidate) =>
          candidate.orchestration === 'graph' && candidate.prompt === requirement
        )
        return turn ? { thread, turn } : undefined
      }, 15_000)
      expect(source.turn.orchestration).toBe('graph')

      const graph = server.runtime.graph
      expect(graph).toBeDefined()
      const identity = await graph!.registry.identify(root)
      await graph!.control.create({
        runId: 'run_pty_graph',
        threadId: source.thread.id,
        projectId: identity.projectId,
        sourceTurnId: source.turn.id,
        plan: testGraphPlan({ workspaceRoot: root }),
        commandId: 'command_pty_graph',
        idempotencyKey: 'create_pty_graph'
      })
      await waitFor(() => sanitizeTerminalText(output).includes('/graph status'), 10_000)
      terminal.resize(52, 16)
      const beforePointer = output.length
      terminal.write('/mouse on\r')
      await waitFor(() => output.slice(beforePointer).includes('Mouse clicks enabled'))

      const beforeBoard = output.length
      for (let row = 1; row <= 16; row += 1) {
        terminal.write(`\x1b[<0;4;${row}M`)
      }
      await waitFor(() => {
        const visible = sanitizeTerminalText(output.slice(beforeBoard))
        return visible.includes('GRAPH ·') && visible.includes('Phase 1 · Implementation')
      })
      expect(sanitizeTerminalText(output.slice(beforeBoard))).toContain('Node')

      const beforeClose = output.length
      terminal.write('\x1b')
      await waitFor(() => output.length > beforeClose)
      await new Promise((resolve) => setTimeout(resolve, 100))
      terminal.write('/quit\r')
      const exit = await withTimeout(exited, 5_000, 'Graph PTY process did not exit')
      expect(exit.exitCode).toBe(0)
      expect(output).not.toContain('\x1b[?1049h')
    } finally {
      dataSubscription.dispose()
      try { terminal.kill() } catch { /* already exited */ }
    }
  }, 30_000)
})

function stringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for PTY state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function waitForValue<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 5_000
): Promise<T> {
  let value: T | undefined
  await waitFor(async () => {
    value = await read()
    return value !== undefined
  }, timeoutMs)
  return value as T
}

async function waitForPtyValue<T>(
  read: () => T | undefined | Promise<T | undefined>,
  options: {
    stage: string
    timeoutMs: number
    getExit: () => { exitCode: number; signal?: number } | undefined
    getOutput: () => string
  }
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    const exit = options.getExit()
    if (exit || Date.now() >= deadline) {
      const reason = exit
        ? `PTY exited with code ${exit.exitCode}${exit.signal === undefined ? '' : ` and signal ${exit.signal}`}`
        : `timed out after ${options.timeoutMs}ms`
      const visibleTail = sanitizeTerminalText(options.getOutput()).slice(-2_000)
      throw new Error(`${options.stage} ${reason}\nPTY output tail:\n${visibleTail || '(empty)'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

async function stopIsolatedManager(controlDir: string): Promise<void> {
  const discovery = await readManagerDiscovery(controlDir).catch(() => null)
  if (!discovery) return
  try {
    process.kill(discovery.pid, 'SIGTERM')
  } catch {
    return
  }
  await waitFor(() => {
    try {
      process.kill(discovery.pid, 0)
      return false
    } catch {
      return true
    }
  }, 5_000).catch(() => undefined)
}
