/**
 * Codex app-server handshake probe for `POST /v1/harnesses/:id/test` (P6-07):
 * `codex app-server` speaks JSON-RPC over stdio; `initialize` proves the
 * channel is alive and returns the server userAgent. `account/read` adds the
 * local account verdict. Optional `model/list` validates explicit model choices;
 * no thread, turn, model prompt, or interactive login is requested.
 */
import { tmpdir } from 'node:os'
import { startHarnessProcess } from '../session/harness-process.js'
import type { HarnessSpawnFn } from '../session/harness-session.js'
import { CodexClient } from '../runtime/codex/codex-client.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'
import { ACP_READINESS_TIMEOUT_MS } from './acp-readiness-probe.js'
import { raceProbeAbort } from './probe-abort.js'
import { nativeAgentNetworkEnv } from './native-agent-network.js'
import { codexMetadataProbeArgs } from './codex-executable.js'

export type CodexHandshakeProbeDeps = {
  spawn?: HarnessSpawnFn
  timeoutMs?: number
  signal?: AbortSignal
  /** Resolved selected-profile environment; injected last. */
  env?: Record<string, string>
  includeModels?: boolean
  resolveSecretEnv?: HarnessSecretRefResolver
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never throws: every failure mode maps to `ok:false` + a short detail. */
export async function probeCodexHandshake(
  definition: HarnessDefinition,
  command: string,
  deps: CodexHandshakeProbeDeps = {}
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  const timeoutMs = deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS
  const signal = AbortSignal.any([
    ...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(timeoutMs)
  ])
  let process
  let pending: ReturnType<typeof startHarnessProcess> | undefined
  try {
    signal.throwIfAborted()
    const secretEnv = await raceProbeAbort(resolveHarnessSecretEnv(definition, deps.resolveSecretEnv), signal)
    signal.throwIfAborted()
    // Metadata only: this never starts a thread or a turn.
    pending = startHarnessProcess({
      signal,
      command,
      args: codexMetadataProbeArgs(definition.launch?.args),
      env: { ...nativeAgentNetworkEnv(definition, globalThis.process.env, { ...secretEnv, ...deps.env }), ...definition.launch?.env },
      secretEnv,
      credentialEnv: deps.env,
      cwd: tmpdir(),
      ...(deps.spawn ? { spawn: deps.spawn } : {})
    })
    process = await raceProbeAbort(pending, signal)
    signal.throwIfAborted()
  } catch (error) {
    // The launcher can settle after cancellation. Reclaim that late child too.
    void pending?.then((child) => child.stop(0).catch(() => undefined), () => undefined)
    return {
      ok: false,
      supported: true,
      protocol: 'codex-app-server',
      detail: `spawn failed: ${errorMessage(error)}`
    }
  }
  const client = new CodexClient({ process })
  try {
    const init = await raceProbeAbort(client.initialize(), signal)
    signal.throwIfAborted()
    const account = await raceProbeAbort(client.accountRead(), signal).catch(
      () => undefined
    )
    signal.throwIfAborted()
    const authentication = account?.account?.type === 'chatgpt' ? 'verified'
      : account?.account ? 'unverified'
      : account?.requiresOpenaiAuth ? 'missing' : 'unverified'
    const login = account?.account?.type ?? (authentication === 'missing' ? 'signed-out' : 'unknown')
    const models = deps.includeModels ? await raceProbeAbort(client.listModelsFlat(), signal) : undefined
    const version = /^.*\/(\d+\.\d+\.\d+.*)$/.exec(init.userAgent)?.[1]
    return {
      ok: true,
      supported: true,
      protocol: 'codex-app-server',
      authentication,
      ...(models ? { models } : {}),
      ...(account ? { authRequired: account.requiresOpenaiAuth && !account.account } : {}),
      agent: {
        name: 'codex',
        ...(version ? { version } : {})
      },
      detail: `initialize ok (login: ${login})`
    }
  } catch (error) {
    const stderr = process.sanitizedStderrTail().trim().split('\n').pop()
    return {
      ok: false,
      supported: true,
      protocol: 'codex-app-server',
      detail:
        `initialize failed: ${errorMessage(error)}` +
        (stderr ? ` — stderr: ${stderr.slice(0, 200)}` : '')
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}
