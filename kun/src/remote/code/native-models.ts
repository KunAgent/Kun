import type { HarnessDefinition } from '../../contracts/harness.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'

/** How long the phone's catalog waits for Agent model lists it had to start, after the readiness wait. */
export const NATIVE_MODELS_WAIT_MS = 4_000

/** The same never-throwing, cached and de-duplicated probe the desktop model menu triggers for this transport. */
function probe(runtime: ServerRuntime, definition: HarnessDefinition): Promise<string[]> | undefined {
  const harnesses = runtime.harnesses
  switch (definition.transport) {
    case 'acp': return harnesses?.acpModels?.probe(definition)
    case 'agent-sdk': return harnesses?.agentSdkModels?.probe(definition)
    case 'codex-app-server': return harnesses?.codexModels?.probe(definition)
    case 'pi-rpc': return harnesses?.piModels?.probe(definition)
    case 'antigravity-cli': return harnesses?.antigravityModels?.probe(definition)
    default: return undefined
  }
}

/**
 * The desktop Code picker loads an Agent's own models the moment it is chosen. A phone has no such moment, so an
 * Agent signed in on this computer (Claude Code, Codex, Gemini…) whose list was never probed would offer no model and
 * silently drop out. Probe the ready ones that have no cached list, in parallel, and wait a bounded time; a slower
 * probe keeps running and fills the next read from its cache.
 */
export async function settleNativeModels(runtime: ServerRuntime, definitions: HarnessDefinition[]): Promise<void> {
  const pending = definitions
    .filter((definition) => definition.modelSource === 'probe' && !runtime.harnesses?.probedModels?.(definition)?.length)
    .flatMap((definition) => {
      const task = probe(runtime, definition)
      return task ? [task.catch(() => [])] : []
    })
  if (pending.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => { timer = setTimeout(resolve, NATIVE_MODELS_WAIT_MS) })
  ])
  clearTimeout(timer)
}
