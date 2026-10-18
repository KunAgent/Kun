import { stdin as processStdin } from 'node:process'
import {
  KunTuiClient,
  resolveTuiConnection,
  type TuiConnection
} from './client.js'
import { TuiController } from './controller.js'
import { ChatSession } from './session/chat-session.js'
import { redirectConsole } from './console-log.js'
import { KUN_TUI_USAGE, parseTuiOptions } from './options.js'
import {
  hasUnpublishedGuiRuntime,
  readGuiSharedSettings,
  type GuiConfigSyncResult
} from '../cli/gui-settings-bridge.js'
import { importGuiProviderCatalogForTui } from './gui-catalog-startup.js'
import {
  TUI_HANDOFF_ENV,
  downloadTuiNode,
  findTuiNode,
  handoffToTuiNode,
  rendererAvailableInProcess,
  BUNDLED_TUI_NODE_VERSION,
  MINIMUM_TUI_RENDERER_NODE_VERSION
} from './tui-node.js'
import { checkStandaloneTuiUpdateOnce, readStandaloneTuiRelease } from '../cli/self-update.js'
import { reconcilePendingTuiUpdate } from '../cli/self-update-reconcile.js'
import type { ClientOwnedRuntimeHandle } from '../cli/client-owned-runtime.js'
import type { TuiOptions } from './options.js'

type WritableLike = { write(chunk: string): unknown }

export type TerminalInput = NodeJS.ReadableStream & { isTTY?: boolean }
export type TerminalOutput = WritableLike & { isTTY?: boolean; columns?: number; rows?: number }

/**
 * Where the opentui renderer runs. It needs Node >= 26.4 with node:ffi;
 * other interpreters (Electron's Node, older system Node) hand off to one.
 */
export type TuiRendererHost = {
  availableInProcess(nodeVersion: string): Promise<boolean>
  handoff(argv: readonly string[], env: NodeJS.ProcessEnv, stderr: WritableLike): Promise<number>
}

export type TuiCommandIo = {
  stdin?: NodeJS.ReadableStream
  stdout: TerminalOutput
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
  fetch?: typeof fetch
  nodeVersion?: string
  resolveConnection?: typeof resolveTuiConnection
  renderer?: TuiRendererHost
}

export const defaultTuiRendererHost: TuiRendererHost = {
  availableInProcess: rendererAvailableInProcess,
  async handoff(argv, env, stderr) {
    if (env[TUI_HANDOFF_ENV] === '1') {
      stderr.write(
        `kun tui: the terminal renderer needs Node.js >=${MINIMUM_TUI_RENDERER_NODE_VERSION} with --experimental-ffi; ` +
        `this process runs Node.js ${process.versions.node}.\n`
      )
      return 69
    }
    let node = findTuiNode(env)
    if (!node) {
      if (env.KUN_TUI_NODE_DOWNLOAD === '0') {
        stderr.write(
          `kun tui: Node.js >=${MINIMUM_TUI_RENDERER_NODE_VERSION} is required for the terminal UI and was not found.\n` +
          'Install Node.js 26 (https://nodejs.org/) or set KUN_TUI_NODE to its executable.\n'
        )
        return 69
      }
      stderr.write(`kun tui: preparing the terminal UI runtime (Node.js ${BUNDLED_TUI_NODE_VERSION}, verified download, one time only)…\n`)
      try {
        node = await downloadTuiNode(env, fetch, (message) => stderr.write(`kun tui: ${message}\n`))
      } catch (error) {
        stderr.write(
          `kun tui: could not prepare Node.js ${BUNDLED_TUI_NODE_VERSION}: ${error instanceof Error ? error.message : String(error)}\n` +
          'Install Node.js 26 (https://nodejs.org/) or set KUN_TUI_NODE to its executable, then run kun again.\n'
        )
        return 69
      }
    }
    return handoffToTuiNode(node, argv, env)
  }
}

export const MINIMUM_TUI_NODE_VERSION = '22.19.0'

export async function runTuiCommand(argv: readonly string[], io: TuiCommandIo): Promise<number> {
  let parsed
  try {
    parsed = parseTuiOptions(argv, io.env ?? {}, io.cwd ?? process.cwd)
  } catch (error) {
    io.stderr.write(`kun tui: ${error instanceof Error ? error.message : String(error)}\n`)
    return 64
  }
  if (!parsed.ok) {
    io.stderr.write(`kun tui: ${parsed.message}\n`)
    io.stderr.write(KUN_TUI_USAGE)
    return 64
  }
  if (parsed.options.help) {
    io.stdout.write(KUN_TUI_USAGE)
    return 0
  }
  const nodeVersion = io.nodeVersion ?? process.versions.node
  if (!isSupportedTuiNodeVersion(nodeVersion)) {
    const platformUpgradeHint = process.platform === 'win32'
      ? 'Windows: winget upgrade --id OpenJS.NodeJS.22 --exact\n'
      : ''
    io.stderr.write(
      `kun tui: Node.js >=${MINIMUM_TUI_NODE_VERSION} is required; current Node.js is ${nodeVersion}.\n` +
      'Upgrade Node.js and open a new terminal. Download: https://nodejs.org/\n' +
      platformUpgradeHint
    )
    return 69
  }
  const input = (io.stdin ?? processStdin) as TerminalInput
  const output = io.stdout
  if (!input.isTTY || !output.isTTY) {
    io.stderr.write('kun tui: a TTY is required; use `kun chat` or `kun run` for non-interactive input.\n')
    return 64
  }
  const rendererHost = io.renderer ?? defaultTuiRendererHost
  if (!await rendererHost.availableInProcess(nodeVersion)) {
    // Hand off before any Runtime is started so exactly one process owns it.
    return rendererHost.handoff(argv, io.env ?? process.env, io.stderr)
  }

  let controller: TuiController | undefined
  let app: import('./app/main.js').OpenTuiApplication | undefined
  let restoreConsole: (() => void) | undefined
  let ownedRuntime: ClientOwnedRuntimeHandle | undefined
  try {
    const guiSettings = parsed.options.url
      ? null
      : await readGuiSharedSettings({ env: io.env ?? process.env })
    if (parsed.options.dataDirSource === 'default' && guiSettings) {
      parsed.options.dataDir = guiSettings.dataDir
    }
    const matchingGuiDataDir = Boolean(
      guiSettings && parsed.options.dataDir === guiSettings.dataDir
    )
    if (
      matchingGuiDataDir &&
      guiSettings &&
      await hasUnpublishedGuiRuntime(guiSettings, io.fetch ?? fetch)
    ) {
      throw new Error(
        'an older GUI Runtime is writing this data directory without discovery; close or update that GUI, then run `kun` again.'
      )
    }
    let guiConfigSync: GuiConfigSyncResult | null = null
    let guiConfigWarning = ''
    if (guiSettings && !parsed.options.url) {
      // Registry remains the catalog authority when the TUI attaches to a live
      // Runtime, whether through --no-start or because another client owns it.
      const imported = await importGuiProviderCatalogForTui({
        dataDir: parsed.options.dataDir,
        settings: guiSettings,
        fetch: io.fetch ?? fetch
      })
      guiConfigSync = imported.sync
      if (imported.warning) {
        guiConfigWarning = imported.warning
        io.stderr.write(`kun tui: ${guiConfigWarning}\n`)
      }
    }
    const { loadTuiKeymap } = await import('./keymap.js')
    const keymapConfig = await loadTuiKeymap()
    const resolveConnection = io.resolveConnection ?? resolveTuiConnection
    const connection = await resolveConnection(parsed.options, io.fetch ?? fetch)
    // From here on the terminal belongs to the inline UI; library logging
    // goes to <data-dir>/logs/tui.log instead of the transcript.
    restoreConsole = redirectConsole(parsed.options.dataDir)
    ownedRuntime = connection.ownedRuntime
    const reconnect = createTuiReconnectResolver(
      connection,
      parsed.options,
      io.fetch ?? fetch,
      resolveConnection
    )
    const client = new KunTuiClient({
      baseUrl: connection.baseUrl,
      runtimeToken: connection.runtimeToken,
      fetch: io.fetch ?? fetch,
      ...(reconnect ? { resolveConnection: reconnect } : {})
    })
    if (guiConfigSync) {
      try {
        const registryBeforeImport = await client.modelConnections()
        const applyRequest = registryBeforeImport.providers.length === 0
          ? guiConfigSync.applyRequest
          : (() => {
              const { modelSelection: _staleCompatibilitySelection, ...catalogOnly } = guiConfigSync.applyRequest
              void _staleCompatibilitySelection
              return catalogOnly
            })()
        const result = await client.applyRuntimeConfig(applyRequest)
        if (!result.ok) {
          guiConfigWarning = result.message
          io.stderr.write(`kun tui: GUI model catalog requires a runtime restart: ${result.message}\n`)
        }
      } catch (error) {
        guiConfigWarning = `could not apply GUI model catalog to the live runtime: ${error instanceof Error ? error.message : String(error)}`
        io.stderr.write(`kun tui: ${guiConfigWarning}\n`)
      }
    }
    // The Manager Registry is the sole model-connection authority. Modern TUI
    // clients must not mirror snapshots directly into the Manager-owned GUI
    // settings document: concurrent projectors can replay an older Registry
    // revision over a newer one. Legacy pre-Manager compatibility keeps its
    // isolated file projection in LegacyModelConnectionTransport.
    controller = new TuiController(
      client,
      parsed.options,
      connection
    )
    const initialModelConnections = await controller.initializeModelConnections()
    if (keymapConfig.warnings.length) {
      for (const warning of keymapConfig.warnings) io.stderr.write(`kun tui: ${warning}\n`)
      controller.notify(keymapConfig.warnings.join(' '), 'error')
    }
    if (guiConfigWarning) controller.notify(guiConfigWarning, 'error')
    if (connection.attached) {
      const owner = connection.attached.ownerKind ? `${connection.attached.ownerKind.toUpperCase()} ` : ''
      controller.notify(`Attached to the running ${owner}Runtime (pid ${connection.attached.pid}); it stops when that client exits.`)
    }
    const session = new ChatSession(controller, keymapConfig.keymap)
    suppressFfiExperimentalWarning()
    const { startOpenTuiApplication } = await import('./app/main.js')
    app = await startOpenTuiApplication(session, terminalStreams(input, output))
    const running = app.run()
    await controller.start()
    void checkStandaloneTuiUpdateOnce({
      env: io.env ?? process.env,
      fetch: io.fetch ?? fetch,
      dataDir: parsed.options.dataDir
    }).then((update) => {
      if (update?.available) {
        controller?.notify(
          `Kun ${update.latest.version} is available with the matching GUI release. Run /update to review it.`
        )
      }
    }).catch(() => undefined)
    void readStandaloneTuiRelease(io.env ?? process.env).then((standalone) => {
      if (!standalone) return undefined
      return reconcilePendingTuiUpdate(standalone.root)
    }).then((pending) => {
      if (!pending) return
      if (pending.kind === 'activated') {
        controller?.notify(
          `Kun ${pending.targetVersion} is now active (updated from ${pending.previousVersion}).`
        )
      } else if (pending.kind === 'failed') {
        controller?.notify(pending.message, 'error')
      }
    }).catch(() => undefined)
    if (parsed.options.graphPrompt) {
      await app.submitStartupGraphPrompt(parsed.options.graphPrompt)
    }
    controller.watchModelConnections(initialModelConnections)
    await running
    return 0
  } catch (error) {
    io.stderr.write(`kun tui: ${error instanceof Error ? error.message : String(error)}\n`)
    return 70
  } finally {
    await app?.stop().catch((error) => {
      io.stderr.write(`kun tui: terminal cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    })
    await controller?.stop().catch(() => undefined)
    restoreConsole?.()
    await ownedRuntime?.stop().catch((error) => {
      io.stderr.write(`kun tui: owned Runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
      return false
    })
  }
}

function terminalStreams(input: TerminalInput, output: TerminalOutput): { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream } {
  return {
    ...(input !== processStdin ? { stdin: input as NodeJS.ReadStream } : {}),
    ...(output !== process.stdout ? { stdout: output as unknown as NodeJS.WriteStream } : {})
  }
}

/**
 * node:ffi emits an ExperimentalWarning the first time it loads. The flag
 * --disable-warning covers the CLI handoff, but an embedding process may
 * not pass it; the warning would otherwise land in the inline transcript.
 */
function suppressFfiExperimentalWarning(): void {
  const original = process.emitWarning
  const filtered = function (this: NodeJS.Process, warning: string | Error, ...rest: unknown[]) {
    const message = typeof warning === 'string' ? warning : warning.message
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type
    if (type === 'ExperimentalWarning' && /\bFFI\b/u.test(message)) return
    return (original as (...args: unknown[]) => void).call(this, warning, ...rest)
  } as typeof process.emitWarning
  process.emitWarning = filtered
}

export function createTuiReconnectResolver(
  connection: TuiConnection,
  options: TuiOptions,
  fetchImpl: typeof fetch,
  resolveConnection: typeof resolveTuiConnection = resolveTuiConnection
): (() => Promise<{ baseUrl: string; runtimeToken: string }>) | undefined {
  if (!connection.discovered || connection.ownedRuntime) return undefined
  // An attached connection belongs to another client. Reconnecting must never
  // start a Runtime of its own when that client exits: nothing would stop it.
  const reconnectOptions = connection.attached ? { ...options, noStart: true } : options
  return async () => {
    const refreshed = await resolveConnection(reconnectOptions, fetchImpl)
    return {
      baseUrl: refreshed.baseUrl,
      runtimeToken: refreshed.runtimeToken
    }
  }
}

export function isSupportedTuiNodeVersion(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/u).slice(0, 3).map(Number)
  const [requiredMajor, requiredMinor, requiredPatch] = MINIMUM_TUI_NODE_VERSION.split('.').map(Number) as [number, number, number]
  if (![major, minor, patch].every(Number.isFinite)) return false
  if (major !== requiredMajor) return major > requiredMajor
  if (minor !== requiredMinor) return minor > requiredMinor
  return patch >= requiredPatch
}

export * from './client.js'
export * from './commands.js'
export * from './controller.js'
export * from './graph-mode.js'
export * from './layout.js'
export * from './keymap.js'
export * from './options.js'
export * from './persistence.js'
export * from './sse.js'
export * from './state.js'
export * from './user-input.js'
