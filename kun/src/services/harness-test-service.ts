import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessDefinition } from '../contracts/harness.js'
import type {
  HarnessTestDetect,
  HarnessTestHandshake,
  HarnessTestRequest,
  HarnessTestResponse,
  HarnessTestTrial
} from '../contracts/harness-test.js'
import { collectSessionEventsOfKind } from '../adapters/session-event-query.js'
import { probeAcpHandshake } from '../harness/acp-handshake-probe.js'
import { probeCodexHandshake } from '../harness/codex-handshake-probe.js'
import { probePiHandshake } from '../harness/pi-handshake-probe.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

/**
 * `POST /v1/harnesses/:id/test` orchestration (docs/ade/impl/p4 §3.5,
 * P4-10). Three progressive levels, each recorded with its own duration:
 * detect → handshake → trial. A failed level stops the deeper ones (a
 * missing binary cannot handshake); a transport without a handshake
 * surface reports `supported: false` and does not block the trial.
 */

/** Fixed trial prompt: cheap, deterministic, exercises streaming + finish. */
export const HARNESS_TEST_PROMPT = 'Reply with exactly: ok'
export const HARNESS_TEST_TIMEOUT_MS = 120_000
const HARNESS_TEST_INTERRUPT_ACK_MS = 5_000

type Runtime = Pick<
  ServerRuntime,
  'harnesses' | 'threadService' | 'turnService' | 'sessionStore' | 'runTurn' | 'defaultModel'
>

export async function runHarnessTest(
  runtime: Runtime,
  definition: HarnessDefinition,
  input: HarnessTestRequest,
  signal?: AbortSignal
): Promise<HarnessTestResponse> {
  const started = Date.now()
  const harnesses = runtime.harnesses!
  const detect = await timed(async () => {
    const status = await harnesses.detector.status(definition.id, { force: true })
    return {
      durationMs: 0,
      ok: status.installed === 'yes' && status.ready !== 'no',
      status
    }
  })

  const base = {
    harnessId: definition.id,
    transport: definition.transport,
    level: input.level,
    detect
  }
  if (input.level === 'detect' || !detect.ok || signal?.aborted) {
    return { ...base, ok: detect.ok && !signal?.aborted, durationMs: Date.now() - started }
  }

  // A trial must probe the selected credential route. The legacy native-only
  // handshake would start Pi/OpenCode with the user's native profile even
  // after gateway readiness succeeded, failing before the actual test turn.
  const handshake = await timed(async () => {
    if (!harnesses.readiness) return runHandshake(runtime, definition, detect.status, signal)
    try {
      await harnesses.readiness.assertReady(harnesses.readiness.route(definition, input), signal)
      return { ok: true, supported: true, protocol: definition.transport,
        detail: 'Selected profile local readiness passed; no model prompt sent' }
    } catch {
      return { ok: false, supported: true, protocol: definition.transport,
        detail: 'Selected profile readiness failed; check the Agent connection and retry' }
    }
  })
  if (input.level === 'handshake') {
    return { ...base, handshake, ok: handshake.ok || !handshake.supported, durationMs: Date.now() - started }
  }
  if (signal?.aborted) {
    return { ...base, handshake, ok: false, durationMs: Date.now() - started }
  }

  // Trial level needs a turn runner bound; embedded scaffolds leave
  // `runTurn` returning void, which runTrial reports as a failed level.
  if (typeof runtime.runTurn !== 'function') {
    const trial: HarnessTestTrial = {
      durationMs: 0,
      ok: false,
      status: 'failed',
      error: 'turn runner is not available in this runtime'
    }
    return { ...base, handshake, trial, ok: false, durationMs: Date.now() - started }
  }
  // A failed real handshake means the harness cannot serve turns — running
  // the trial anyway would only burn quota for a guaranteed failure.
  if (handshake.supported && !handshake.ok) {
    return { ...base, handshake, ok: false, durationMs: Date.now() - started }
  }
  const trial = await timed(() => runTrial(runtime, definition, input, signal))
  return { ...base, handshake, trial, ok: trial.ok, durationMs: Date.now() - started }
}

async function timed<T extends { durationMs: number }>(
  run: () => Promise<Omit<T, 'durationMs'> | T>
): Promise<T> {
  const started = Date.now()
  const result = await run()
  return { ...result, durationMs: Date.now() - started } as T
}

async function runHandshake(
  runtime: Runtime,
  definition: HarnessDefinition,
  detectStatus: HarnessTestDetect['status'],
  signal?: AbortSignal
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  const command =
    typeof detectStatus.resolvedCommand === 'string' && detectStatus.resolvedCommand
      ? detectStatus.resolvedCommand
      : (definition.launch?.command ?? definition.detect?.command ?? definition.id)
  switch (definition.transport) {
    case 'acp':
      return probeAcpHandshake(definition, command, {
        resolveSecretEnv: runtime.harnesses?.resolveSecretEnv,
        signal
      })
    case 'codex-app-server':
      return probeCodexHandshake(definition, command, {
        resolveSecretEnv: runtime.harnesses?.resolveSecretEnv,
        signal
      })
    case 'pi-rpc':
      return probePiHandshake(definition, command, {
        resolveSecretEnv: runtime.harnesses?.resolveSecretEnv
      })
    case 'agent-sdk': {
      const models = await runtime.harnesses?.agentSdkModels?.probe(definition).catch(() => [])
      return models && models.length > 0
        ? { ok: true, supported: true, protocol: 'agent-sdk', models }
        : { ok: false, supported: true, protocol: 'agent-sdk', detail: 'model probe returned no models' }
    }
    default:
      // cursor-sdk / antigravity-cli / native-loop have no lightweight
      // handshake surface — detection evidence stands on its own.
      return {
        ok: true,
        supported: false,
        detail: `transport ${definition.transport} has no handshake protocol`
      }
  }
}

async function runTrial(
  runtime: Runtime,
  definition: HarnessDefinition,
  input: HarnessTestRequest,
  signal?: AbortSignal
): Promise<Omit<HarnessTestTrial, 'durationMs'>> {
  const timeoutMs = input.timeoutMs ?? HARNESS_TEST_TIMEOUT_MS
  const workspace = await mkdtemp(join(tmpdir(), 'kun-harness-test-'))
  // Trial and admission must use the same profile/model. Choosing the first
  // discovered model (or Kun's model) can fail a healthy native subscription.
  const route = runtime.harnesses?.readiness?.route(definition, input)
  const credentialMode = route?.credentialMode ?? input.credentialMode ?? definition.credentialModes[0]
  const providerId = route?.providerId ?? input.providerId
  const model = route?.model ?? input.model ?? (credentialMode === 'native-login' ? 'default' : runtime.defaultModel ?? 'default')
  let threadId: string | null = null
  let cleanupDeferred = false
  try {
    signal?.throwIfAborted()
    const thread = await runtime.threadService.create(
      {
        title: 'Harness connection test',
        titleAuto: false,
        workspace,
        model,
        harnessId: definition.id,
        credentialMode,
        ...(providerId ? { providerId } : {}),
        mode: 'agent',
        approvalPolicy: 'never',
        sandboxMode: 'read-only'
      },
      // `side` threads are filtered out of the default conversation list —
      // the trial thread is deleted after anyway, this is belt + suspenders.
      { relation: 'side' }
    )
    threadId = thread.id
    const start = await runtime.turnService.startTurn({
      threadId: thread.id,
      request: {
        prompt: HARNESS_TEST_PROMPT,
        model,
        ...(providerId ? { providerId } : {}),
        harnessId: definition.id,
        credentialMode,
        mode: 'agent',
        clientSurface: 'api',
        disableUserInput: true,
        approvalPolicy: 'never',
        sandboxMode: 'read-only'
      }
    })
    const turnId = start.turnId
    const running = runtime.runTurn(thread.id, turnId)
    if (running === undefined) {
      return { ok: false, status: 'failed', error: 'turn runner is not available in this runtime' }
    }
    const outcome = await withTimeout(running, timeoutMs, () =>
      runtime.turnService.interruptTurn({ threadId: thread.id, turnId }).then(() => undefined), signal)
    const turn = await runtime.turnService.getTurn(thread.id, turnId)
    const unsettled = !turn || !['completed', 'failed', 'aborted'].includes(turn.status)
    if ((outcome === 'timeout_unconfirmed' || outcome === 'aborted') && unsettled) {
      // A stuck harness may keep its process alive after the HTTP client is
      // gone. Defer deletion until its owned turn actually settles; removing
      // the workspace now would invalidate a still-running child process.
      cleanupDeferred = true
      void running.then(() => undefined, () => undefined)
        .then(async () => {
          await runtime.threadService.delete(thread.id).catch(() => undefined)
          await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
        })
      return {
        ok: false,
        status: 'failed',
        error: outcome === 'timeout_unconfirmed'
          ? `${signal?.aborted ? 'Trial cancelled' : 'Trial timed out'}; the interrupt was not acknowledged. The turn may still be running.`
          : `${signal?.aborted ? 'Trial cancelled' : 'Trial timed out'}; the interrupt was acknowledged but the turn has not settled.`,
        terminalCode: 'trial_timeout_unconfirmed'
      }
    }
    const raw = turn?.status ?? outcome ?? 'failed'
    const ok = raw === 'completed'
    const status =
      raw === 'aborted' || raw === 'suspended' || raw === 'suspended_pending_supervision'
        ? 'aborted'
        : ok
          ? 'completed'
          : 'failed'
    // Usage events are read before the thread is deleted — deletion clears
    // the session event log with the rest of the thread directory.
    const usage = await trialUsage(runtime, thread.id, turnId)
    return {
      ok,
      status: ok ? 'completed' : status === 'aborted' ? 'aborted' : 'failed',
      ...(turn?.error ? { error: turn.error.slice(0, 400) } : {}),
      ...(turn?.terminalCode ? { terminalCode: turn.terminalCode } : {}),
      ...(usage ? { usage } : {})
    }
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 400)
    }
  } finally {
    if (threadId && !cleanupDeferred) {
      await runtime.threadService.delete(threadId).catch(() => undefined)
    }
    if (!cleanupDeferred) await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function trialUsage(
  runtime: Runtime,
  threadId: string,
  turnId: string
): Promise<HarnessTestTrial['usage']> {
  const events = await collectSessionEventsOfKind(runtime.sessionStore, threadId, 'usage').catch(
    () => []
  )
  const event = [...events].reverse().find((entry) => entry.turnId === turnId && entry.usage)
  if (!event?.usage) return undefined
  return {
    totalTokens: event.usage.totalTokens,
    promptTokens: event.usage.promptTokens,
    completionTokens: event.usage.completionTokens,
    ...(event.model ? { model: event.model } : {}),
    ...(event.providerId ? { providerId: event.providerId } : {})
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<void>,
  signal?: AbortSignal
): Promise<T | 'aborted' | 'timeout_unconfirmed'> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let interruptTimer: ReturnType<typeof setTimeout> | null = null
  let abortListener: (() => void) | null = null
  let interrupting: Promise<'aborted' | 'timeout_unconfirmed'> | null = null
  const interruptOnce = (): Promise<'aborted' | 'timeout_unconfirmed'> => {
    if (interrupting) return interrupting
    interrupting = (async () => {
      const acknowledged = await Promise.race([
        onTimeout().then(() => true).catch(() => false),
        new Promise<false>((resolve) => {
          interruptTimer = setTimeout(() => resolve(false), HARNESS_TEST_INTERRUPT_ACK_MS)
        })
      ])
      return acknowledged ? 'aborted' : 'timeout_unconfirmed'
    })()
    return interrupting
  }
  try {
    return await Promise.race([
      promise,
      (async (): Promise<'aborted' | 'timeout_unconfirmed'> => {
        await new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
        return interruptOnce()
      })(),
      ...(signal ? [new Promise<'aborted' | 'timeout_unconfirmed'>((resolve) => {
        abortListener = () => { void interruptOnce().then(resolve) }
        if (signal.aborted) abortListener()
        else signal.addEventListener('abort', abortListener, { once: true })
      })] : [])
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (interruptTimer) clearTimeout(interruptTimer)
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
  }
}
