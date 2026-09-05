import { stdin as processStdin, stdout as processStdout } from 'node:process'
import {
  KunTuiClient,
  resolveTuiConnection,
  type TuiConnection
} from './client.js'
import { TuiController } from './controller.js'
import { KUN_TUI_USAGE, parseTuiOptions } from './options.js'
import {
  hasUnpublishedGuiRuntime,
  readGuiSharedSettings,
  type GuiConfigSyncResult
} from '../cli/gui-settings-bridge.js'
import { importGuiProviderCatalogForTui } from './gui-catalog-startup.js'
import type { TerminalInput, TerminalOutput } from './pi-terminal.js'
import { checkStandaloneTuiUpdateOnce, readStandaloneTuiRelease } from '../cli/self-update.js'
import { reconcilePendingTuiUpdate } from '../cli/self-update-reconcile.js'
import type { ClientOwnedRuntimeHandle } from '../cli/client-owned-runtime.js'
import type { TuiOptions } from './options.js'

type WritableLike = { write(chunk: string): unknown }

export type TuiCommandIo = {
  stdin?: NodeJS.ReadableStream
  stdout: TerminalOutput
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
  fetch?: typeof fetch
  nodeVersion?: string
  resolveConnection?: typeof resolveTuiConnection
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
  const output = io.stdout as TerminalOutput
  if (!input.isTTY || !output.isTTY) {
    io.stderr.write('kun tui: a TTY is required; use `kun chat` or `kun run` for non-interactive input.\n')
    return 64
  }

  let controller: TuiController | undefined
  let app: import('./pi-app.js').PiTuiApplication | undefined
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
      // Registry remains the catalog authority when explicit attach mode sees
      // a live Runtime; default owned startup will reject that foreign owner.
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
    const [{ PiTuiApplication }, { loadTuiKeymap }] = await Promise.all([
      import('./pi-app.js'),
      import('./keymap.js')
    ])
    const keymapConfig = await loadTuiKeymap()
    const resolveConnection = io.resolveConnection ?? resolveTuiConnection
    const connection = await resolveConnection(parsed.options, io.fetch ?? fetch)
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
    app = new PiTuiApplication(controller, input, output, keymapConfig.keymap)
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
    await ownedRuntime?.stop().catch((error) => {
      io.stderr.write(`kun tui: owned Runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
      return false
    })
  }
}

export function createTuiReconnectResolver(
  connection: TuiConnection,
  options: TuiOptions,
  fetchImpl: typeof fetch,
  resolveConnection: typeof resolveTuiConnection = resolveTuiConnection
): (() => Promise<{ baseUrl: string; runtimeToken: string }>) | undefined {
  if (!connection.discovered || connection.ownedRuntime) return undefined
  return async () => {
    const refreshed = await resolveConnection(options, fetchImpl)
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
