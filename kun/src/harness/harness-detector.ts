import semver from 'semver'
import type { ChildProcess } from 'node:child_process'
import type { HarnessDefinition, HarnessId, HarnessStatus } from '../contracts/harness.js'
import {
  resolveExecutable as defaultResolveExecutable,
  spawnOwnedProcess,
  stopOwnedProcess
} from '../process/owned-process.js'
import type { HarnessLoginState } from './harness-login-probes.js'

const VERSION_TIMEOUT_MS = 5_000
const DEFAULT_TTL_MS = 60_000
const DEFAULT_VERSION_PATTERN = /\d+\.\d+\.\d+/
const MAX_CAPTURE_BYTES = 64 * 1024

export type SpawnCaptured = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number }
) => Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }>

/** Default capture runner: the managed launcher, so detection follows process lifecycle rules. */
export async function spawnCaptured(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number }
): Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }> {
  let child: ChildProcess
  try {
    child = await spawnOwnedProcess(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (error) {
    return { stdout: '', stderr: String(error), timedOut: false, exitCode: null }
  }
  let stdout = ''
  let stderr = ''
  let stdoutBytes = 0
  let stderrBytes = 0
  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes <= MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8')
    stdoutBytes += chunk.length
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes <= MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8')
    stderrBytes += chunk.length
  })
  const exit = new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code))
    child.once('error', () => resolveExit(null))
  })
  const timedOut = await Promise.race([
    exit.then(() => false),
    new Promise<true>((resolveTimeout) => setTimeout(() => resolveTimeout(true), options.timeoutMs))
  ])
  if (timedOut) {
    await stopOwnedProcess(child, { graceMs: 0 }).catch(() => undefined)
    return { stdout, stderr, timedOut: true, exitCode: null }
  }
  return { stdout, stderr, timedOut: false, exitCode: await exit }
}

function versionSupported(version: string | null, minVersion: string | undefined): boolean | undefined {
  if (!version || !minVersion) return undefined
  try {
    return semver.gte(version, minVersion)
  } catch {
    return undefined
  }
}

export class HarnessDetector {
  private readonly cache = new Map<HarnessId, { status: HarnessStatus; expiresAt: number }>()
  private readonly inflight = new Map<HarnessId, Promise<HarnessStatus>>()

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
       * ACP initialize handshake after the version probe (P3-11). Only runs
       * for `transport: 'acp'` definitions with a resolved command; its
       * verdict lands on `status.ready` with a sanitized stderr summary.
       */
      probeReady?: (
        def: HarnessDefinition,
        command: string
      ) => Promise<{ ready: 'yes' | 'no'; detail?: string }>
      probeLogin: (def: HarnessDefinition, command: string) => Promise<HarnessLoginState>
      nowMs: () => number
      nowIso: () => string
      ttlMs?: number
    }
  ) {}

  async status(id: HarnessId, opts: { force?: boolean } = {}): Promise<HarnessStatus> {
    const cached = this.cache.get(id)
    if (!opts.force && cached && cached.expiresAt > this.deps.nowMs()) return cached.status
    const pending = this.inflight.get(id)
    if (pending) return pending
    const run = this.detect(id)
    this.inflight.set(id, run)
    try {
      return await run
    } finally {
      this.inflight.delete(id)
    }
  }

  /**
   * Cached verdict only; undefined until a probe lands. Does not schedule
   * detection — the synchronous router path uses this so an unprobed harness
   * is not confused with a known-missing one.
   */
  cachedStatus(id: HarnessId): HarnessStatus | undefined {
    const cached = this.cache.get(id)
    return cached && cached.expiresAt > this.deps.nowMs() ? cached.status : undefined
  }

  /** True while a detection pass is inflight for this harness. */
  detecting(id: HarnessId): boolean {
    return this.inflight.has(id)
  }

  /** Non-blocking snapshot: cached status or an optimistic unknown entry. */
  peek(id: HarnessId): HarnessStatus | undefined {
    const cached = this.cache.get(id)
    if (cached && cached.expiresAt > this.deps.nowMs()) return cached.status
    void this.status(id).catch(() => undefined)
    return {
      harnessId: id,
      installed: 'unknown',
      login: 'unknown',
      checkedAt: this.deps.nowIso(),
      detecting: true
    }
  }

  private store(id: HarnessId, status: HarnessStatus): HarnessStatus {
    this.cache.set(id, {
      status,
      expiresAt: this.deps.nowMs() + (this.deps.ttlMs ?? DEFAULT_TTL_MS)
    })
    return status
  }

  private async detect(id: HarnessId): Promise<HarnessStatus> {
    const def = this.deps.definitions().find((d) => d.id === id)
    const checkedAt = this.deps.nowIso()
    if (!def) {
      return this.store(id, {
        harnessId: id,
        installed: 'unknown',
        login: 'unknown',
        checkedAt,
        message: 'unknown harness'
      })
    }
    if (def.transport === 'native-loop') {
      return this.store(id, {
        harnessId: id,
        installed: 'yes',
        login: 'not-required',
        checkedAt
      })
    }
    // SDK transports are bundled with the app; without a detect section they
    // are always installed, and only the login probe matters.
    if (!def.detect && def.transport !== 'acp' && def.transport !== 'terminal') {
      const login = await this.deps
        .probeLogin(def, def.id)
        .catch(() => 'unknown' as HarnessLoginState)
      return this.store(id, { harnessId: id, installed: 'yes', login, checkedAt })
    }
    const bundled = this.deps.bundled?.(def)
    const command = bundled?.command ?? (await this.resolveCommand(def))
    if (!command && !bundled) {
      // A fallback binary that resolves (e.g. `codex` when `codex-acp` is
      // absent) means an installed tool missing its ACP adapter — surface the
      // definition's install guidance instead of a bare "not found" (P3-11).
      const hint = def.detect?.adapterHint
      const hintPresent = hint
        ? await (this.deps.resolveExecutable ?? defaultResolveExecutable)(
            hint.command
          ).catch(() => undefined)
        : undefined
      return this.store(id, {
        harnessId: id,
        installed: 'no',
        login: 'unknown',
        checkedAt,
        message:
          hint && hintPresent
            ? hint.message
            : `command not found: ${def.detect?.command ?? def.id}`
      })
    }
    const version = bundled?.version
      ? { text: bundled.version, semver: semver.valid(bundled.version) ? bundled.version : null }
      : command
        ? await this.readVersion(def, command)
        : undefined
    const probeCommand = command ?? def.id
    if (version === undefined) {
      const login = await this.deps.probeLogin(def, probeCommand).catch(() => 'unknown' as HarnessLoginState)
      return this.store(id, {
        harnessId: id,
        installed: 'unknown',
        login,
        resolvedCommand: command,
        checkedAt,
        message: 'version probe timed out or failed'
      })
    }
    const login = await this.deps.probeLogin(def, probeCommand).catch(() => 'unknown' as HarnessLoginState)
    // ACP harnesses also prove readiness: the binary answers `initialize`
    // within the timeout, speaks a supported protocol, and stays alive.
    let ready: HarnessStatus['ready']
    let readyMessage: string | undefined
    if (def.transport === 'acp' && command && this.deps.probeReady) {
      const result = await this.deps
        .probeReady(def, command)
        .catch((error) => ({ ready: 'no' as const, detail: String(error) }))
      ready = result.ready
      if (result.ready === 'no') {
        readyMessage = `ACP initialize failed: ${result.detail ?? 'no response'}`
      }
    }
    return this.store(id, {
      harnessId: id,
      installed: 'yes',
      version: version.text || undefined,
      versionSupported: versionSupported(version.semver, def.detect?.minVersion),
      ...(ready ? { ready } : {}),
      login,
      resolvedCommand: command,
      checkedAt,
      ...(readyMessage ? { message: readyMessage.slice(0, 512) } : {})
    })
  }

  private async resolveCommand(def: HarnessDefinition): Promise<string | undefined> {

    const resolve = this.deps.resolveExecutable ?? defaultResolveExecutable
    const override = this.deps.overrides()[def.id]?.binaryPath?.trim()
    if (override) {
      const resolved = await resolve(override)
      if (resolved) return resolved
    }
    if (!def.detect) return undefined
    for (const candidate of [def.detect.command, ...(def.detect.aliases ?? [])]) {
      const resolved = await resolve(candidate)
      if (resolved) return resolved
    }
    return undefined
  }

  private async readVersion(
    def: HarnessDefinition,
    command: string
  ): Promise<{ text: string; semver: string | null } | undefined> {
    if (!def.detect) return undefined
    const pattern = def.detect.versionPattern
      ? new RegExp(def.detect.versionPattern)
      : DEFAULT_VERSION_PATTERN
    const result = await this.deps
      .spawnCaptured(command, def.detect.versionArgs ?? ['--version'], {
        timeoutMs: VERSION_TIMEOUT_MS
      })
      .catch(() => undefined)
    if (!result || result.timedOut) return undefined
    const firstLine = result.stdout.split('\n')[0]?.trim() ?? ''
    const match = firstLine.match(pattern) ?? result.stdout.match(pattern)
    const text = match?.[0]
    if (!text) return { text: firstLine.slice(0, 64), semver: null }
    return { text, semver: semver.valid(text) ? text : (semver.coerce(text)?.version ?? null) }
  }
}
