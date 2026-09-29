/**
 * PiAgent (P6-09/10): a pooled `pi --mode rpc` process implementing the shared
 * `HarnessAgent` contract.
 *
 * Layout decisions:
 * - pi binds `cwd` at spawn and hosts ONE session per process, so the catalog
 *   declares `poolScope: 'workspace'` — the shared runtime keys the pool by
 *   harness+credential+workspace.
 * - The `kun-pi-bridge` extension (tool-approval gate) is written under a Kun
 *   config dir and loaded explicitly via `--extension`; `--no-extensions`
 *   blocks whatever the user's own pi config would otherwise load.
 * - `KUN_PI_PERMISSION_FILE` points at a per-process file the session rewrites
 *   per turn from the resolved permission mode (bridge re-reads per call).
 * - Gateway mode arrives with `PI_CODING_AGENT_DIR` in credentialEnv (generated
 *   by the pi case in the credential resolver — models.json + env apiKey ref).
 *   Native login leaves pi's default agent dir alone (D2).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { startHarnessProcess } from '../../session/harness-process.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import type {
  HarnessAgent,
  HarnessAgentConnectInput,
  HarnessAgentFactory,
  HarnessAgentInfo,
  HarnessSession,
  HarnessSessionStartInput
} from '../../session/harness-session.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import { PiClient, type PiDebugLog } from './pi-client.js'
import { PiSession } from './pi-session.js'
import {
  KUN_PI_BRIDGE_FILENAME,
  kunPiBridgeSource
} from './kun-pi-bridge-source.js'

export type PiAgentOptions = {
  /** Kun-managed dir for bridge extension + permission files (e.g. <dataDir>/pi). */
  configDir?: () => string
  /** Test seam: pre-built client/process pair skips spawn + handshake. */
  client?: PiClient
  process?: HarnessProcess
  debug?: PiDebugLog
}

export class PiAgent implements HarnessAgent {
  readonly info: HarnessAgentInfo
  private readonly client: PiClient
  private readonly process: HarnessProcess
  private readonly permissionFile: string | undefined
  /** 'kun' under kun-gateway (generated models.json); undefined otherwise. */
  private readonly gatewayProviderId: string | undefined
  private sessionOwner: string | undefined

  private constructor(
    client: PiClient,
    proc: HarnessProcess,
    info: HarnessAgentInfo,
    permissionFile: string | undefined,
    gatewayProviderId: string | undefined
  ) {
    this.client = client
    this.process = proc
    this.info = info
    this.permissionFile = permissionFile
    this.gatewayProviderId = gatewayProviderId
  }

  static async connect(
    input: HarnessAgentConnectInput,
    options: PiAgentOptions = {}
  ): Promise<PiAgent> {
    if (options.client && options.process) {
      return new PiAgent(
        options.client,
        options.process,
        { protocolName: 'pi-rpc' },
        undefined,
        undefined
      )
    }
    const configDir = options.configDir?.() ?? input.cwd
    const runDir = join(configDir, 'proc', `pi-${randomUUID()}`)
    const bridgeDir = join(runDir, 'extensions')
    mkdirSync(bridgeDir, { recursive: true, mode: 0o700 })
    const bridgePath = join(bridgeDir, KUN_PI_BRIDGE_FILENAME)
    writeFileSync(bridgePath, kunPiBridgeSource(), { mode: 0o600 })
    const permissionFile = join(runDir, 'kun-permission.json')

    const args = [
      '--mode',
      'rpc',
      // Only the Kun bridge may attach; discovered user extensions would
      // bypass the permission gate otherwise.
      '--no-extensions',
      '--extension',
      bridgePath,
      ...input.args
    ]
    const proc = await startHarnessProcess({
      command: input.command,
      args,
      env: { ...input.env, KUN_PI_PERMISSION_FILE: permissionFile },
      secretEnv: input.secretEnv,
      credentialEnv: input.credentialEnv,
      stripEnv: input.stripEnv,
      cwd: input.cwd,
      ...(input.spawn ? { spawn: input.spawn } : {})
    })
    const client = options.client ?? new PiClient(proc, { debug: options.debug })
    try {
      // No handshake in pi rpc; get_state doubles as liveness + session probe.
      await client.getState()
      // The credential resolver injects PI_CODING_AGENT_DIR only under
      // kun-gateway — its generated models.json declares the `kun` provider.
      const gatewayProviderId = input.credentialEnv.PI_CODING_AGENT_DIR
        ? 'kun'
        : undefined
      return new PiAgent(
        client,
        proc,
        { protocolName: 'pi-rpc', requiresAuthentication: undefined },
        permissionFile,
        gatewayProviderId
      )
    } catch (error) {
      await proc.stop().catch(() => undefined)
      throw error
    }
  }

  get closed(): boolean {
    return this.client.closed
  }

  onExit(
    listener: (exit: { code: number | null; signal: string | null }) => void
  ): void {
    void this.process.exit.then((info) =>
      listener({ code: info.code, signal: info.signal })
    )
  }

  sessionThreadIds(): readonly string[] {
    return this.sessionOwner ? [this.sessionOwner] : []
  }

  sessionCapabilities(): { continuation: 'native'; fingerprint: unknown } {
    return {
      continuation: 'native',
      fingerprint: { protocol: 'pi-rpc' }
    }
  }

  /**
   * RPC model list. Under native login this is pi's authenticated catalog;
   * under kun-gateway it is the generated models.json (kun provider only).
   */
  async listModels(): Promise<string[]> {
    const models = await this.client.getAvailableModels()
    const out: string[] = []
    for (const m of models) {
      const id = typeof m.id === 'string' ? m.id : undefined
      const provider = typeof m.provider === 'string' ? m.provider : undefined
      if (id) out.push(provider ? `${provider}/${id}` : id)
    }
    return out
  }

  async startSession(input: HarnessSessionStartInput): Promise<HarnessSession> {
    return this.bindSession(input)
  }

  async resumeSession(
    input: HarnessSessionStartInput
  ): Promise<HarnessSession> {
    const sessionPath = input.preparation.nativeSessionId
    if (!sessionPath) {
      throw new HarnessTransportError(
        'harness_not_ready',
        'no native pi session to resume'
      )
    }
    try {
      const vetoed = await this.client.switchSession(sessionPath)
      if (vetoed) {
        throw new HarnessTransportError(
          'harness_not_ready',
          'pi switch_session was cancelled by an extension'
        )
      }
    } catch (error) {
      throw new HarnessTransportError(
        'harness_not_ready',
        `pi switch_session failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error
      )
    }
    return this.bindSession(input)
  }

  private async bindSession(
    input: HarnessSessionStartInput
  ): Promise<PiSession> {
    // The wire model is applied per session. `kun/<provider>/<model>` (gateway)
    // and `provider/model` probe results split on the first slash; a bare id
    // resolves against the kun provider under gateway, or is left to pi's
    // current model under native login (provider is unknowable here).
    if (input.model) {
      const slash = input.model.indexOf('/')
      const provider =
        slash > 0
          ? input.model.slice(0, slash)
          : this.gatewayProviderId
      const modelId = slash > 0 ? input.model.slice(slash + 1) : input.model
      if (provider) {
        try {
          await this.client.setModel(provider, modelId)
        } catch (error) {
          throw new HarnessTransportError(
            'agent_error',
            `pi set_model ${input.model} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            error
          )
        }
      }
    }
    const state = await this.client.getState()
    this.sessionOwner = input.threadId
    return new PiSession(
      this.client,
      state.sessionFile ?? input.preparation.nativeSessionId ?? '',
      input,
      (mode) => this.writePermissionMode(mode)
    )
  }

  /**
   * Permission mode is per-turn config: the session start writes it so the
   * bridge's next tool_call reads the current value (hot switch without
   * respawn). Missing/unwritable file → bridge fail-closes to 'ask'.
   */
  writePermissionMode(mode: 'read-only' | 'ask' | 'auto' | 'bypass'): void {
    if (!this.permissionFile) return
    try {
      writeFileSync(this.permissionFile, JSON.stringify({ mode }), {
        mode: 0o600
      })
    } catch {
      // Fail closed on the bridge side; nothing else to do here.
    }
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}

/** Factory wiring for `SessionTurnRuntime`'s pooled connect path. */
export function makePiAgentFactory(options: PiAgentOptions = {}): HarnessAgentFactory {
  return {
    connect: (input) => PiAgent.connect(input, options)
  }
}

/** Legacy capability flags for the delegated-runtime surface. */
export const PI_RPC_LEGACY_CAPABILITIES = {
  nativeResume: true,
  structuredStreaming: true,
  kunTools: false,
  externalApproval: true,
  /** `steer` queues mid-run input (delivered after the current tool batch). */
  liveSteering: true,
  nativeContextTelemetry: true,
  /** `fork` at a user-message entry. */
  fork: true
} as const
