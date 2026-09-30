/**
 * Codex app-server handshake probe for `POST /v1/harnesses/:id/test` (P6-07):
 * `codex app-server` speaks JSON-RPC over stdio; `initialize` proves the
 * channel is alive and returns the server userAgent. `account/read` adds the
 * login verdict without touching credentials — both calls are free.
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
  let process
  try {
    const secretEnv = await resolveHarnessSecretEnv(definition, deps.resolveSecretEnv)
    // No credential env: the handshake proves the binary speaks the
    // app-server protocol; it never starts a thread or turn.
    process = await startHarnessProcess({
      command,
      args: codexMetadataProbeArgs(definition.launch?.args),
      env: { ...nativeAgentNetworkEnv(definition, globalThis.process.env, secretEnv), ...definition.launch?.env },
      secretEnv,
      cwd: tmpdir(),
      ...(deps.spawn ? { spawn: deps.spawn } : {})
    })
  } catch (error) {
    return {
      ok: false,
      supported: true,
      protocol: 'codex-app-server',
      detail: `spawn failed: ${errorMessage(error)}`
    }
  }
  const client = new CodexClient({ process })
  try {
    const init = await raceProbeAbort(withTimeout(client.initialize(), timeoutMs), deps.signal)
    const account = await raceProbeAbort(withTimeout(client.accountRead(), timeoutMs), deps.signal).catch(
      () => undefined
    )
    deps.signal?.throwIfAborted()
    const login = account?.account
      ? account.account.type === 'chatgpt'
        ? `chatgpt${account.account.email ? ` ${account.account.email}` : ''}`
        : 'apiKey'
      : account?.requiresOpenaiAuth
        ? 'signed-out'
        : 'no-account'
    const version = /^.*\/(\d+\.\d+\.\d+.*)$/.exec(init.userAgent)?.[1]
    return {
      ok: true,
      supported: true,
      protocol: 'codex-app-server',
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms`)),
        timeoutMs
      ).unref()
    )
  ])
}
