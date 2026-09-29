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

type Runtime = Pick<
  ServerRuntime,
  'harnesses' | 'threadService' | 'turnService' | 'sessionStore' | 'runTurn' | 'defaultModel'
>

export async function runHarnessTest(
  runtime: Runtime,
  definition: HarnessDefinition,
  input: HarnessTestRequest
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
  if (input.level === 'detect' || !detect.ok) {
    return { ...base, ok: detect.ok, durationMs: Date.now() - started }
  }

  const handshake = await timed(() => runHandshake(runtime, definition, detect.status))
  if (input.level === 'handshake') {
    return { ...base, handshake, ok: handshake.ok || !handshake.supported, durationMs: Date.now() - started }
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
  const trial = await timed(() => runTrial(runtime, definition, input))
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
  detectStatus: HarnessTestDetect['status']
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  const command =
    typeof detectStatus.resolvedCommand === 'string' && detectStatus.resolvedCommand
      ? detectStatus.resolvedCommand
      : (definition.launch?.command ?? definition.detect?.command ?? definition.id)
  switch (definition.transport) {
    case 'acp':
      return probeAcpHandshake(definition, command, {
        resolveSecretEnv: runtime.harnesses?.resolveSecretEnv
      })
    case 'codex-app-server':
      return probeCodexHandshake(definition, command, {
        resolveSecretEnv: runtime.harnesses?.resolveSecretEnv
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
  input: HarnessTestRequest
): Promise<Omit<HarnessTestTrial, 'durationMs'>> {
  const timeoutMs = input.timeoutMs ?? HARNESS_TEST_TIMEOUT_MS
  const workspace = await mkdtemp(join(tmpdir(), 'kun-harness-test-'))
  const model =
    input.model ??
    runtime.harnesses?.probedModels?.(definition)?.[0] ??
    definition.staticModels[0] ??
    runtime.defaultModel
  let threadId: string | null = null
  try {
    const thread = await runtime.threadService.create(
      {
        title: 'Harness connection test',
        titleAuto: false,
        workspace,
        model,
        harnessId: definition.id,
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
        ...(input.providerId ? { providerId: input.providerId } : {}),
        harnessId: definition.id,
        ...(input.credentialMode ? { credentialMode: input.credentialMode } : {}),
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
    const outcome = await withTimeout(running, timeoutMs, async () => {
      await runtime.turnService.interruptTurn({ threadId: thread.id, turnId }).catch(() => undefined)
    })
    const turn = await runtime.turnService.getTurn(thread.id, turnId)
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
    if (threadId) {
      await runtime.threadService.delete(threadId).catch(() => undefined)
    }
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<void>
): Promise<T | 'aborted'> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      (async (): Promise<'aborted'> => {
        await new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
        await onTimeout().catch(() => undefined)
        return 'aborted'
      })()
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
