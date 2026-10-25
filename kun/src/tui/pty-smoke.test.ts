import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSharedRuntime, stopSharedRuntime } from '../cli/shared-runtime.js'
import { readManagerRuntime, resolveServiceManager } from '../manager/manager-client.js'
import { readManagerDiscovery } from '../manager/manager-discovery.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import { startKunServe, type KunServeHandle } from '../server/runtime-factory.js'
import {
  testGraphConfig,
  testGraphPlan
} from '../graph/graph-test-fixtures.test-support.js'
import { KunTuiClient } from './client.js'
import { sanitizeTerminalText } from './layout.js'
import { PtyScreen, ptyTuiNode } from './pty-screen.test-support.js'

const worktreeRoot = resolve(import.meta.dirname, '../../..')
const cliEntry = join(worktreeRoot, 'kun/dist/cli/serve-entry.js')
const roots: string[] = []
const servers: KunServeHandle[] = []
// The renderer needs Node >= 26.4; the CLI under test runs on the test
// interpreter and hands off to this one, exactly as an installed `kun` does.
const tuiNode = ptyTuiNode()

type PtyExit = { exitCode: number; signal?: number }

/** Spawn `kun` in a PTY whose output feeds an emulated terminal screen. */
function spawnKun(args: string[], options: { cols: number; rows: number; env?: NodeJS.ProcessEnv }) {
  const screen = new PtyScreen(options.cols, options.rows)
  const terminal = pty.spawn(process.execPath, [cliEntry, ...args], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: worktreeRoot,
    env: stringEnvironment({ ...(options.env ?? process.env), KUN_TUI_NODE: tuiNode?.path, KUN_TUI_NODE_DOWNLOAD: '0' })
  })
  let exitState: PtyExit | undefined
  const data = terminal.onData((chunk) => screen.write(chunk))
  screen.onReply((reply) => { if (!exitState) terminal.write(reply) })
  const exited = new Promise<PtyExit>((accept) => {
    terminal.onExit((state) => {
      exitState = state
      accept(state)
    })
  })
  return {
    terminal,
    screen,
    exited,
    getExit: () => exitState,
    /** Raw output stream, for escape-sequence assertions. */
    output: () => screen.raw,
    /** Text on the emulated screen and its scrollback. */
    visible: () => sanitizeTerminalText(screen.text()),
    resize(cols: number, rows: number) {
      terminal.resize(cols, rows)
      screen.resize(cols, rows)
    },
    dispose() {
      data.dispose()
      try { terminal.kill() } catch { /* already exited */ }
    }
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(roots.map((root) => stopSharedRuntime(root).catch(() => false)))
  await Promise.all(roots.map((root) => stopIsolatedManager(join(root, 'control'))))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32' || !existsSync(cliEntry) || !tuiNode)('kun tui PTY smoke', () => {
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
            contextWindowTokens: 372_000,
            reasoning: { supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', requestProtocol: 'openai-responses' }
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

    const tui = spawnKun(['tui', '--no-start', '--data-dir', root, '--workspace', root], {
      cols: 88,
      rows: 26,
      env: {
        ...process.env,
        KUN_MANAGER_CONTROL_DIR: join(root, 'control'),
        KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
      }
    })
    const { terminal } = tui
    const visible = tui.visible
    const output = tui.output

    try {
      await waitFor(() => {
        const text = visible()
        return text.includes('北冥有鱼') && text.includes('Ask anything') && text.includes('ctrl+p commands')
      }, 20_000).catch((error) => { throw new Error(`${String(error)}\nPTY screen:\n${visible()}`) })
      // Kun runs full screen on the alternate screen with the mouse captured.
      expect(output()).toContain('\x1b[?1049h')
      expect(output()).toContain('\x1b[?1000h')
      expect(visible()).not.toContain('/model')
      expect(visible()).not.toContain('runtime ready')
      expect(visible()).not.toContain('MCP ')
      expect(visible()).not.toContain('No threads found')

      await waitFor(() => /gpt-5\.6-luna.* · high/u.test(visible()))
      terminal.write('\x14') // Ctrl+T cycles high -> max.
      await waitFor(() => visible().includes('Reasoning effort: max'))
      await waitFor(() => /gpt-5\.6-luna.* · max/u.test(visible()))

      terminal.write('\x18n') // Ctrl+X N
      const thread = await waitForValue(async () =>
        (await client.listThreads()).find((item) => item.title === 'Terminal chat')
      ).catch((error) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nPTY screen:\n${visible().slice(-2_000)}`)
      })
      await waitFor(() => visible().includes('Terminal chat'))

      terminal.write('/rename PTY smoke\r')
      await waitFor(async () => (await client.getThread(thread.id)).title === 'PTY smoke')

      const beforeResize = output().length
      tui.resize(52, 14)
      await waitFor(() => output().length > beforeResize)
      const beforeWideResize = output().length
      tui.resize(112, 26)
      await waitFor(() => output().length > beforeWideResize)

      const turn = await server.runtime.turnService.startTurn({
        threadId: thread.id,
        request: { prompt: 'hold for interrupt', model: 'gpt-5.6-luna', mode: 'agent' }
      })
      await waitFor(() => visible().includes('esc interrupt') && visible().includes('waiting'))
      expect(visible()).not.toContain('Tip:')
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
        itemId: reasoningBase.id, item: { ...reasoningBase, text: 'Checking the model.\nInspect the active model capability.' }
      })
      // Collapsed reasoning shows its first line only.
      await waitFor(() => visible().includes('Thinking: Checking the model.'))
      expect(visible()).not.toContain('Inspect the active model capability.')

      terminal.write('\x18p') // Ctrl+X P hands selection back to the terminal.
      await waitFor(() =>
        visible().includes('Mouse off') &&
        output().lastIndexOf('\x1b[?1000l') > output().lastIndexOf('\x1b[?1000h')
      ).catch((error) => { throw new Error(`${String(error)}\nPTY screen:\n${tui.screen.view().join('\n')}`) })
      terminal.write('\x18p') // The same binding captures the mouse again.
      await waitFor(() =>
        visible().includes('Mouse on') &&
        output().lastIndexOf('\x1b[?1000h') > output().lastIndexOf('\x1b[?1000l')
      )
      // Clicking the collapsed Thinking row expands it in place, and again collapses it.
      const thinkingRow = () => tui.screen.view().findIndex((line) => line.includes('Thinking: Checking the model.'))
      const clickThinking = () => {
        const row = thinkingRow() + 1
        terminal.write(`\x1b[<0;8;${row}M\x1b[<0;8;${row}m`)
      }
      expect(thinkingRow()).toBeGreaterThanOrEqual(0)
      clickThinking()
      await waitFor(() => visible().includes('Inspect the active model capability.'))
      clickThinking()
      await waitFor(() => !visible().includes('Inspect the active model capability.'))
      expect((await client.getThread(thread.id)).turns.find((candidate) => candidate.id === turn.turnId)?.status).toBe('running')

      terminal.write('/thinking\r')
      await waitFor(() => visible().includes('Thinking expanded.'))
      await waitFor(() => visible().includes('Inspect the active model capability.'))
      terminal.write('/thinking\r')
      await waitFor(() => visible().includes('Thinking collapsed.'))
      await waitFor(() => !tui.screen.view().join('\n').includes('Inspect the active model capability.'))
      await server.runtime.events.record({
        kind: 'assistant_reasoning_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: reasoningBase.id, item: { ...reasoningBase, text: ' This fragment stays hidden.' }
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await tui.screen.settled()
      expect(visible()).not.toContain('This fragment stays hidden.')
      terminal.write('/thinking\r')
      await waitFor(() => visible().includes('Thinking expanded.'))

      await server.runtime.events.record({
        kind: 'assistant_text_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: itemBase.id, item: { ...itemBase, text: 'Hel' }
      })
      await waitFor(() => visible().includes('Hel ▍') && visible().includes('responding'))
      expect((await client.getThread(thread.id)).turns.find((candidate) => candidate.id === turn.turnId)?.status).toBe('running')
      await server.runtime.events.record({
        kind: 'assistant_text_delta', threadId: thread.id, turnId: turn.turnId,
        itemId: itemBase.id, item: { ...itemBase, text: 'lo' }
      })
      await waitFor(() => visible().includes('Hello'))

      terminal.write('\x1b') // Escape interrupts the active turn
      await waitFor(async () => {
        const detail = await client.getThread(thread.id)
        return detail.turns.find((candidate) => candidate.id === turn.turnId)?.status === 'aborted'
      })

      terminal.write('/quit\r')
      const exit = await withTimeout(tui.exited, 10_000, 'PTY process did not exit')
      expect(exit.exitCode).toBe(0)
      expect(output()).toContain('\x1b[?2004l')
      expect(output()).toContain('\x1b[?1049l')
      // The restored main screen tells the user how to reopen the session.
      await tui.screen.settled()
      await waitFor(() => visible().includes(`kun tui --thread ${thread.id}`))
      await expect(client.runtimeInfo()).resolves.toMatchObject({
        instanceId: server.instanceId
      })
    } finally {
      tui.dispose()
    }
  }, 60_000)

  it('stops its owned Runtime and Manager after Ctrl+C and reopens persisted history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-standalone-'))
    roots.push(root)
    const controlDir = join(root, 'control')
    const tui = spawnKun(['--data-dir', root, '--workspace', root], {
      cols: 88,
      rows: 26,
      env: {
        ...process.env,
        KUN_MANAGER_CONTROL_DIR: controlDir,
        KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
      }
    })
    const { terminal, exited } = tui

    try {
      const manager = await waitForPtyValue(
        async () => (await resolveServiceManager(controlDir)) ?? undefined,
        {
          stage: 'Service Manager readiness',
          timeoutMs: 35_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )
      const connection = await waitForPtyValue(
        async () => (await resolveSharedRuntime(root, fetch, { manager, controlDir })) ?? undefined,
        {
          stage: 'shared Runtime readiness',
          timeoutMs: 35_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )
      expect(connection.discovery.launchMode).toBe('shared')
      expect(connection.discovery.clientOwnerKind).toBe('tui')
      expect((await readManagerRuntime(manager, 'production'))?.clientOwnerKind).toBe('tui')
      const ownedPid = connection.discovery.pid
      const managerInstanceId = manager.discovery.instanceId
      const client = new KunTuiClient({
        baseUrl: connection.discovery.baseUrl,
        runtimeToken: connection.discovery.runtimeToken
      })
      const persistedThread = await client.createThread({
        title: 'Sequential TUI state',
        workspace: root,
        model: 'model-a',
        mode: 'agent'
      })
      await waitForPtyValue(
        () => tui.visible().includes('北冥有鱼') &&
          tui.visible().includes('/connect') &&
          tui.visible().includes('ctrl+p commands')
          ? true
          : undefined,
        {
          stage: 'TUI first render',
          timeoutMs: 30_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )

      terminal.write('\x03')
      await new Promise((resolve) => setTimeout(resolve, 80))
      terminal.write('\x03')
      const exit = await withTimeout(exited, 15_000, 'standalone TUI process did not exit')
      expect(exit.exitCode).toBe(0)
      expect(tui.output().lastIndexOf('\x1b[?1049l')).toBeGreaterThan(tui.output().lastIndexOf('\x1b[?1049h'))
      await waitFor(() => !processIsAlive(ownedPid), 10_000)
      await waitFor(() => !processIsAlive(manager.discovery.pid), 10_000)
      expect(await readManagerDiscovery(controlDir)).toBeNull()
      await expect(fetch(`${manager.discovery.baseUrl}/health`)).rejects.toThrow()

      const second = spawnKun(['--data-dir', root, '--workspace', root, '--continue'], {
        cols: 88,
        rows: 26,
        env: {
          ...process.env,
          KUN_MANAGER_CONTROL_DIR: controlDir,
          KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
        }
      })
      const { terminal: secondTerminal, exited: secondExited } = second
      try {
        let secondManagerPid: number | undefined
        const secondConnection = await waitForPtyValue(
          async () => {
            const nextManager = await resolveServiceManager(controlDir)
            if (!nextManager) return undefined
            secondManagerPid = nextManager.discovery.pid
            const candidate = await resolveSharedRuntime(root, fetch, { manager: nextManager, controlDir })
            expect(nextManager.discovery.instanceId).not.toBe(managerInstanceId)
            return candidate?.discovery.instanceId !== connection.discovery.instanceId
              ? candidate ?? undefined
              : undefined
          },
          {
            stage: 'sequential Runtime readiness',
            timeoutMs: 35_000,
            getExit: second.getExit,
            getOutput: second.visible
          }
        )
        expect(secondConnection.discovery.clientOwnerKind).toBe('tui')
        const secondClient = new KunTuiClient({
          baseUrl: secondConnection.discovery.baseUrl,
          runtimeToken: secondConnection.discovery.runtimeToken
        })
        await expect(secondClient.getThread(persistedThread.id)).resolves.toMatchObject({
          id: persistedThread.id,
          title: 'Sequential TUI state'
        })
        await waitForPtyValue(
          () => second.visible().includes('北冥有鱼') ? true : undefined,
          {
            stage: 'sequential TUI first render',
            timeoutMs: 30_000,
            getExit: second.getExit,
            getOutput: second.visible
          }
        )

        secondTerminal.write('/quit\r')
        const secondExit = await withTimeout(secondExited, 15_000, 'second TUI process did not exit')
        expect(secondExit.exitCode).toBe(0)
        await waitFor(() => !processIsAlive(secondConnection.discovery.pid), 10_000)
        await waitFor(() => secondManagerPid !== undefined && !processIsAlive(secondManagerPid), 10_000)
        expect(await readManagerDiscovery(controlDir)).toBeNull()
      } finally {
        second.dispose()
      }
    } finally {
      tui.dispose()
    }
  }, 90_000)

  it('stops its owned Runtime and Manager after the TUI receives SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-signal-exit-'))
    roots.push(root)
    const controlDir = join(root, 'control')
    const tui = spawnKun(['--data-dir', root, '--workspace', root], {
      cols: 88,
      rows: 26,
      env: {
        ...process.env,
        KUN_MANAGER_CONTROL_DIR: controlDir,
        KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json')
      }
    })
    const { terminal, exited } = tui

    try {
      const manager = await waitForPtyValue(
        async () => (await resolveServiceManager(controlDir)) ?? undefined,
        {
          stage: 'signal test Manager readiness',
          timeoutMs: 35_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )
      const connection = await waitForPtyValue(
        async () => (await resolveSharedRuntime(root, fetch, { manager, controlDir })) ?? undefined,
        {
          stage: 'signal test Runtime readiness',
          timeoutMs: 35_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )
      expect(connection.discovery.clientOwnerKind).toBe('tui')
      await waitForPtyValue(
        () => tui.visible().includes('北冥有鱼') ? true : undefined,
        {
          stage: 'signal test first render',
          timeoutMs: 30_000,
          getExit: tui.getExit,
          getOutput: tui.visible
        }
      )

      terminal.kill('SIGTERM')
      await withTimeout(exited, 15_000, 'SIGTERM TUI process did not exit')
      await waitFor(() => !processIsAlive(connection.discovery.pid), 10_000)
      await waitFor(() => !processIsAlive(manager.discovery.pid), 10_000)
      expect(await readManagerDiscovery(controlDir)).toBeNull()
      await expect(fetch(`${manager.discovery.baseUrl}/health`)).rejects.toThrow()
    } finally {
      tui.dispose()
    }
  }, 90_000)

  it('submits --graph after startup and opens a narrow Graph board with a mouse click', async () => {
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
    const tui = spawnKun(['--no-start', '--data-dir', root, '--workspace', root, '--graph', requirement], {
      cols: 88,
      rows: 26
    })
    const { terminal, exited } = tui

    try {
      const source = await waitForPtyValue(async () => {
        const thread = (await client.listThreads())[0]
        if (!thread) return undefined
        const detail = await client.getThread(thread.id)
        const turn = detail.turns.find((candidate) =>
          candidate.orchestration === 'graph' &&
          candidate.items.some((item) => item.kind === 'user_message' && item.text === requirement)
        )
        return turn ? { thread, turn } : undefined
      }, {
        stage: 'startup Graph turn',
        timeoutMs: 35_000,
        getExit: tui.getExit,
        getOutput: tui.visible
      })
      expect(source.turn.orchestration).toBe('graph')
      expect(source.turn.items).toContainEqual(expect.objectContaining({
        kind: 'user_message',
        text: requirement
      }))

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
      await waitFor(() => tui.visible().includes('⬡ Graph'), 10_000)
      tui.resize(52, 16)
      const graphRow = () => tui.screen.view().findIndex((line) => line.trimStart().startsWith('⬡ Graph'))
      await waitFor(() => graphRow() >= 0)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const row = graphRow() + 1
      terminal.write(`\x1b[<0;4;${row}M\x1b[<0;4;${row}m`)
      // The board opens as a dialog over the session.
      await waitFor(() => {
        const view = sanitizeTerminalText(tui.screen.view().join('\n'))
        // Formatted for the dialog's inner width, so long labels are elided.
        return view.includes('GRAPH ·') && view.includes('Phase 1 · Implemen')
      }).catch((error) => { throw new Error(`${String(error)}\nPTY screen:\n${tui.screen.view().join('\n')}`) })
      expect(sanitizeTerminalText(tui.screen.view().join('\n'))).toContain('Node')

      terminal.write('\x1b')
      await waitFor(() => !sanitizeTerminalText(tui.screen.view().join('\n')).includes('GRAPH ·'))
      await new Promise((resolve) => setTimeout(resolve, 100))
      terminal.write('/quit\r')
      const exit = await withTimeout(exited, 10_000, 'Graph PTY process did not exit')
      expect(exit.exitCode).toBe(0)
    } finally {
      tui.dispose()
    }
  }, 60_000)
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return String((error as NodeJS.ErrnoException).code ?? '') === 'EPERM'
  }
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
