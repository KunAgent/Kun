import semver from 'semver'
import { stripVTControlCharacters } from 'node:util'
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { HarnessDefinition, HarnessId, HarnessStatus } from '../contracts/harness.js'
import { harnessStatusReasonCode } from '../contracts/harness.js'
import {
  resolveExecutable as defaultResolveExecutable,
  spawnOwnedProcess,
  stopOwnedProcess
} from '../process/owned-process.js'
import type { HarnessLoginState } from './harness-login-probes.js'
import { nativeAgentNetworkStatus } from './native-agent-network.js'
import { resolveCodexExecutable } from './codex-executable.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { prepareDeepSeekHarnessLaunch } from './deepseek-harness-launch.js'
import { buildHarnessEnv } from './harness-env.js'
import { raceProbeAbort } from './probe-abort.js'
import { harnessIntegrationInfo } from './harness-integration.js'
import { executablePackageVersion, isApplicationLauncher } from './harness-executable-metadata.js'
import { redactApprovalSensitiveText } from '../domain/approval.js'
import { sdkProcessBaseEnv } from '../runtime/agent-sdk/sdk-process-environment.js'

const VERSION_TIMEOUT_MS = 5_000
const DEFAULT_TTL_MS = 60_000
const DETECTION_TIMEOUT_MS = 45_000
const DEFAULT_VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/
const MAX_CAPTURE_BYTES = 64 * 1024

export type ProbeOptions = { signal?: AbortSignal; timeoutMs?: number }
export type SpawnCapturedOptions = {
  timeoutMs: number
  signal?: AbortSignal
  env?: Record<string, string | undefined>
}
export type SpawnCaptured = (
  command: string,
  args: readonly string[],
  options: SpawnCapturedOptions
) => Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }>

/** Bounded local metadata execution, including a launcher that resolves late. */
export const spawnCaptured: SpawnCaptured = async (command, args, options) => {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), timeout])
  let child: ChildProcess | undefined
  let pending: Promise<ChildProcess> | undefined
  let stdout = ''
  let stderr = ''
  let stdoutBytes = 0
  let stderrBytes = 0
  try {
    signal.throwIfAborted()
    pending = spawnOwnedProcess(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: buildHarnessEnv({ base: harnessExecutableEnv(sdkProcessBaseEnv()), add: options.env })
    })
    child = await raceProbeAbort(pending, signal)
    signal.throwIfAborted()
    child.stdout?.on('data', (chunk: Buffer) => {
      const retained = chunk.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - stdoutBytes))
      stdout += retained.toString('utf8')
      stdoutBytes += retained.length
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const retained = chunk.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - stderrBytes))
      stderr += retained.toString('utf8')
      stderrBytes += retained.length
    })
    const process = child
    const exit = new Promise<number | null>((resolveExit) => {
      if (process.exitCode !== null || process.signalCode !== null) return resolveExit(process.exitCode)
      process.once('exit', (code) => resolveExit(code))
      process.once('error', () => resolveExit(null))
    })
    const exitCode = await raceProbeAbort(exit, signal)
    signal.throwIfAborted()
    return { stdout, stderr, timedOut: false, exitCode }
  } catch (error) {
    options.signal?.throwIfAborted()
    return { stdout, stderr: stderr || redactApprovalSensitiveText(String(error)), timedOut: timeout.aborted, exitCode: null }
  } finally {
    if (child) await stopOwnedProcess(child, { graceMs: 0 }).catch(() => undefined)
    else void pending?.then((late) => stopOwnedProcess(late, { graceMs: 0 }).catch(() => undefined), () => undefined)
  }
}

function versionSupported(version: string | null, detect: HarnessDefinition['detect']): boolean | undefined {
  if (!detect?.minVersion && !detect?.exactVersion) return undefined
  if (!version) return false
  try {
    return detect.exactVersion ? version === detect.exactVersion : semver.gte(version, detect.minVersion!)
  } catch { return false }
}

function fileIdentity(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    const stat = statSync(path, { bigint: true })
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  } catch { return 'missing' }
}

export class HarnessDetector {
  private readonly cache = new Map<HarnessId, { status: HarnessStatus; expiresAt: number; identity: string; binary?: string }>()
  private readonly generations = new Map<HarnessId, number>()
  private readonly inflight = new Map<HarnessId, { identity: string; promise: Promise<HarnessStatus>; signal?: AbortSignal }>()

  constructor(
    private readonly deps: {
      definitions: () => readonly HarnessDefinition[]
      /** Settings overrides: binaryPath per harness id. */
      overrides: () => Record<string, { binaryPath?: string }>
      /**
       * Bundled-runtime resolver (e.g. the packaged Claude Agent SDK): when it
       * returns an entry the harness counts as installed even without a
       * PATH-visible binary, and its version is preferred over a CLI probe.
       */
      bundled?: (def: HarnessDefinition) => { version?: string; command?: string } | undefined
      spawnCaptured: SpawnCaptured
      /** Command resolution; injectable so tests avoid real PATH lookups. */
      resolveExecutable?: (command: string) => Promise<string | undefined>
      /**
       * Protocol initialize handshake after the version probe. Runs for ACP
       * and native Codex with a resolved command; its
       * verdict lands on `status.ready` with a sanitized stderr summary.
       * 'unknown' (P4-03) means the probe timed out — not a failure verdict.
       */
      probeReady?: (
        def: HarnessDefinition,
        command: string,
        options?: ProbeOptions
      ) => Promise<{ ready: 'yes' | 'no' | 'unknown'; detail?: string }>
      /**
       * Legacy cache kept only for invalidation on launch failures. Success
       * entries are no longer reused without current profile evidence.
       */
      readinessCache?: {
        get(id: HarnessId, command: string, version: string | undefined, identity?: string): Promise<'yes' | undefined>
        set(id: HarnessId, command: string, version: string | undefined, identity?: string): Promise<void>
        clear(id: HarnessId): Promise<void>
      }
      probeLogin: (def: HarnessDefinition, command: string, options?: ProbeOptions) => Promise<HarnessLoginState>
      nowMs: () => number
      nowIso: () => string
      ttlMs?: number
    }
  ) {}

  async status(id: HarnessId, opts: ProbeOptions & { force?: boolean } = {}): Promise<HarnessStatus> {
    opts.signal?.throwIfAborted()
    const identity = this.identity(id)
    const cached = this.cachedStatus(id)
    const def = this.deps.definitions().find((candidate) => candidate.id === id)
    // External account/config/secret state can change independently of a
    // version string. Only the embedded loop can reuse a detection verdict.
    if (!opts.force && def?.transport === 'native-loop' && cached) return cached
    const pending = this.inflight.get(id)
    if (!opts.force && pending?.identity === identity && pending.signal === opts.signal) return pending.promise
    const signal = AbortSignal.any([
      ...(opts.signal ? [opts.signal] : []), AbortSignal.timeout(opts.timeoutMs ?? DETECTION_TIMEOUT_MS)
    ])
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    const run = raceProbeAbort(this.detect(id, identity, signal, generation), signal)
    this.inflight.set(id, { identity, promise: run, signal: opts.signal })
    try { return await run } finally {
      if (this.inflight.get(id)?.promise === run) this.inflight.delete(id)
    }
  }

  /**
   * Cached verdict only; undefined until a probe lands. Does not schedule
   * detection — the synchronous router path uses this so an unprobed harness
   * is not confused with a known-missing one.
   */
  cachedStatus(id: HarnessId): HarnessStatus | undefined {
    const cached = this.cache.get(id)
    const def = this.deps.definitions().find((candidate) => candidate.id === id)
    return !def?.launch?.secretEnv?.length && cached && cached.identity === this.identity(id) &&
      cached.binary === fileIdentity(cached.status.resolvedCommand) && cached.expiresAt > this.deps.nowMs()
      ? cached.status
      : undefined
  }

  /** True while a detection pass is inflight for this harness. */
  detecting(id: HarnessId): boolean {
    return this.inflight.get(id)?.identity === this.identity(id)
  }

  /**
   * A real turn launch failed after a probe said ready (P4-03): drop the
   * persisted readiness entry and mark the cached status `ready: 'no'` so
   * the UI reflects the observed failure until the next detection pass.
   */
  recordLaunchFailure(id: HarnessId, detail: string): void {
    void this.deps.readinessCache?.clear(id).catch(() => undefined)
    const cached = this.cache.get(id)
    const current = cached?.identity === this.identity(id) ? cached.status : undefined
    const message = detail.slice(0, 512)
    this.store(id, {
      ...(current ?? {
        harnessId: id,
        installed: 'unknown' as const,
        login: 'unknown' as const
      }),
      harnessId: id,
      ready: 'no',
      reasonCode: 'handshake_failed' as const,
      checkedAt: this.deps.nowIso(),
      message
    })
  }

  /** Non-blocking snapshot: cached status or an optimistic unknown entry. */
  peek(id: HarnessId): HarnessStatus | undefined {
    const cached = this.cachedStatus(id)
    if (cached) return cached
    void this.status(id).catch(() => undefined)
    return {
      harnessId: id,
      installed: 'unknown',
      login: 'unknown',
      checkedAt: this.deps.nowIso(),
      detecting: true
    }
  }

  private store(id: HarnessId, status: HarnessStatus, identity = this.identity(id)): HarnessStatus {
    // A settings edit can finish before an older probe. Return its result to
    // that caller, but never let it replace the new configuration's verdict.
    if (identity === this.identity(id)) {
      this.cache.set(id, {
        status,
        identity,
        binary: fileIdentity(status.resolvedCommand),
        expiresAt: this.deps.nowMs() + (this.deps.ttlMs ?? DEFAULT_TTL_MS)
      })
    }
    return status
  }

  private identity(id: HarnessId): string {
    const def = this.deps.definitions().find((candidate) => candidate.id === id)
    const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
    const claude = process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')
    const codex = process.env.CODEX_HOME ?? join(home, '.codex')
    const configPaths = [join(claude, '.credentials.json'), join(claude, 'settings.json'),
      join(codex, 'auth.json'), join(codex, 'config.toml'),
      join(home, '.config', 'opencode', 'opencode.json'), join(home, '.local', 'share', 'opencode', 'auth.json')]
    return createHash('sha256').update(JSON.stringify({
      definition: def,
      network: def ? nativeAgentNetworkStatus(def).networkFingerprint : undefined,
      binaryPath: this.deps.overrides()[id]?.binaryPath?.trim(),
      environment: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
      files: configPaths.map((path) => [path, fileIdentity(path)])
    })).digest('hex')
  }

  private async detect(id: HarnessId, identity: string, signal: AbortSignal, generation: number): Promise<HarnessStatus> {
    const wait = async <T>(operation: Promise<T>): Promise<T> => {
      const result = await raceProbeAbort(operation, signal)
      signal.throwIfAborted()
      return result
    }
    const store = (status: HarnessStatus): HarnessStatus => {
      signal.throwIfAborted()
      return this.generations.get(id) === generation ? this.store(id, status, identity) : status
    }
    signal.throwIfAborted()
    const def = this.deps.definitions().find((d) => d.id === id)
    const checkedAt = this.deps.nowIso()
    if (!def) {
      return store({
        harnessId: id,
        installed: 'unknown',
        login: 'unknown',
        checkedAt,
        message: 'unknown harness'
      })
    }
    if (def.transport === 'native-loop') {
      return store({
        harnessId: id,
        installed: 'yes',
        login: 'not-required',
        checkedAt
      })
    }
    const override = this.deps.overrides()[id]?.binaryPath?.trim()
    if (def.transport === 'application') {
      const info = await wait(harnessIntegrationInfo(def, { binaryPath: override, resolve: this.deps.resolveExecutable }))
      return store({ harnessId: id, installed: info.application ? 'yes' : 'no', login: 'not-required', checkedAt,
        resolvedCommand: info.application?.path ?? override, applicationPath: info.application?.path,
        configurationPaths: info.configurations.filter((target) => target.exists).map((target) => target.path),
        ...(info.application ? {} : { reasonCode: 'not_installed' as const }) })
    }
    // SDK transports are bundled with the app; without a detect section they
    // are always installed, and only the login probe matters.
    if (!override && !def.detect && def.transport !== 'acp' && def.transport !== 'terminal') {
      const login = await wait(this.deps.probeLogin(def, def.id, { signal }).catch(() => 'unknown' as HarnessLoginState))
      return store({ harnessId: id, installed: 'yes', login, checkedAt })
    }
    const bundled = override ? undefined : this.deps.bundled?.(def)
    const command = bundled?.command ?? (await wait(this.resolveCommand(def, signal)))
    if (!command && !bundled) {
      // A fallback binary that resolves (e.g. `codex` when `codex-acp` is
      // absent) means an installed tool missing its ACP adapter — surface the
      // definition's install guidance instead of a bare "not found" (P3-11).
      const hint = override ? undefined : def.detect?.adapterHint
      const hintPresent = hint
        ? await wait((this.deps.resolveExecutable ?? defaultResolveExecutable)(
            hint.command
          ).catch(() => undefined))
        : undefined
      return store({
        harnessId: id,
        installed: 'no',
        login: 'unknown',
        checkedAt,
        reasonCode: hint && hintPresent ? 'adapter_missing' : 'not_installed',
        message:
          hint && hintPresent
            ? hint.message
            : `command not found: ${override ?? def.detect?.command ?? def.id}`
      })
    }
    if (def.transport === 'terminal') {
      // Terminal agents (p4 §3.8): a resolved command is the whole verdict.
      // Many interactive CLIs ignore `--version` and wait on stdin instead —
      // probing would hang 5s and mask an installed agent as 'unknown'.
      const login = await wait(this.deps.probeLogin(def, command ?? def.id, { signal }).catch(() => 'unknown' as HarnessLoginState))
      return store({
        harnessId: id,
        installed: 'yes',
        login,
        resolvedCommand: command,
        checkedAt
      })
    }
    const version = bundled?.version
      ? { text: bundled.version, semver: semver.valid(bundled.version) ? bundled.version : null }
      : command
        ? await wait(this.readVersion(def, command, signal))
        : undefined
    const probeCommand = command ?? def.id
    if (version && 'identityMismatch' in version && version.identityMismatch) return store({ harnessId: id, installed: 'no', login: 'unknown', checkedAt,
      reasonCode: 'not_installed', message: `The resolved command does not identify ${def.displayName}; specify the correct Agent executable` })
    if (version === undefined) {
      const login = await wait(this.deps.probeLogin(def, probeCommand, { signal }).catch(() => 'unknown' as HarnessLoginState))
      return store({
        harnessId: id,
        installed: 'unknown',
        login,
        resolvedCommand: command,
        checkedAt,
        message: 'version probe timed out or failed'
      })
    }
    const login = await wait(this.deps.probeLogin(def, probeCommand, { signal }).catch(() => 'unknown' as HarnessLoginState))
    const supported = versionSupported(version.semver, def.detect)
    // Protocol harnesses also prove readiness: a version response alone does
    // not mean the agent can serve turns.
    let ready: HarnessStatus['ready']
    let readyMessage: string | undefined
    if (supported !== false && (def.transport === 'acp' || def.transport === 'codex-app-server') && command && this.deps.probeReady) {
      const protocolLabel = def.transport === 'acp' ? 'ACP' : 'Codex app-server'
      // The old persisted cache knew only command/version, so a replaced
      // binary or rotated profile could reuse a success. Metadata is cheap;
      // every external detection now establishes fresh protocol evidence.
      const result = await wait(this.deps.probeReady(def, command, { signal })
        .catch((error) => ({ ready: 'no' as const, detail: String(error) })))
      ready = result.ready
      if (result.ready === 'no') {
        readyMessage = `${protocolLabel} initialize failed: ${result.detail ?? 'no response'}`
      } else if (result.ready === 'unknown') {
        readyMessage = `${protocolLabel} readiness probe inconclusive: ${result.detail ?? 'timeout'}`
      }
    }
    const status: HarnessStatus = {
      harnessId: id,
      installed: 'yes',
      version: version.text || undefined,
      versionSupported: supported,
      ...(ready ? { ready } : {}),
      login,
      resolvedCommand: command,
      checkedAt,
      ...(readyMessage ? { message: readyMessage.slice(0, 512) } : {})
    }
    // P4-05: stamp the stable reason code so clients localize a label and a
    // next step instead of parsing `message` (which stays detail-only).
    const reasonCode = harnessStatusReasonCode(status)
    return store(reasonCode ? { ...status, reasonCode } : status)
  }

  private async resolveCommand(def: HarnessDefinition, signal: AbortSignal): Promise<string | undefined> {

    const resolve = this.deps.resolveExecutable ?? ((command: string) => defaultResolveExecutable(command, { env: harnessExecutableEnv({ ...process.env, ...def.launch?.env }) }))
    const override = this.deps.overrides()[def.id]?.binaryPath?.trim()
    if (override) {
      const resolved = await raceProbeAbort(resolve(override), signal)
      signal.throwIfAborted()
      if (resolved && def.detect?.rejectApplicationLauncher && await isApplicationLauncher(resolved)) return undefined
      return resolved
    }
    if (!def.detect) return undefined
    if (!override && !this.deps.resolveExecutable && def.transport === 'codex-app-server' && def.detect.command === 'codex') {
      return resolve(await raceProbeAbort(resolveCodexExecutable(), signal))
    }
    for (const candidate of [def.detect.command, ...(def.detect.aliases ?? [])]) {
      signal.throwIfAborted()
      const resolved = await raceProbeAbort(resolve(candidate), signal)
      signal.throwIfAborted()
      if (resolved && def.detect.rejectApplicationLauncher && await isApplicationLauncher(resolved)) continue
      if (resolved) return resolved
    }
    return undefined
  }

  private async readVersion(
    def: HarnessDefinition,
    command: string,
    signal: AbortSignal
  ): Promise<{ text: string; semver: string | null; identityMismatch?: boolean } | undefined> {
    if (!def.detect) return undefined
    if (def.detect.versionPackage) {
      const version = await executablePackageVersion(command, def.detect.versionPackage)
      signal.throwIfAborted()
      return { text: version ?? '', semver: version ?? null }
    }
    const pattern = def.detect.versionPattern
      ? new RegExp(def.detect.versionPattern)
      : DEFAULT_VERSION_PATTERN
    const launch = await raceProbeAbort(prepareDeepSeekHarnessLaunch({
      harnessId: def.id, command, args: def.detect.versionArgs ?? ['--version'], env: def.launch?.env
    }), signal)
    signal.throwIfAborted()
    const result = await this.deps
      .spawnCaptured(launch.command, launch.args, {
        timeoutMs: VERSION_TIMEOUT_MS, signal, env: launch.env
      })
      .catch(() => undefined)
    signal.throwIfAborted()
    if (!result || result.timedOut || result.exitCode !== 0) return undefined
    if (def.detect.identityPattern && !new RegExp(def.detect.identityPattern, 'i').test(stripVTControlCharacters(result.stdout))) {
      return { text: '', semver: null, identityMismatch: true }
    }
    const firstLine = result.stdout.split('\n')[0]?.trim() ?? ''
    const match = firstLine.match(pattern) ?? result.stdout.match(pattern)
    const text = match?.[0]
    if (!text) return { text: firstLine.slice(0, 64), semver: null }
    return { text, semver: semver.valid(text) ? text : (semver.coerce(text)?.version ?? null) }
  }
}
