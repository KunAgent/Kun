import { createRequire } from 'node:module'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector, spawnCaptured } from './harness-detector.js'
import { probeHarnessLogin } from './harness-login-probes.js'

const runtimeRequire = createRequire(import.meta.url)

function bundledClaudeCode(): { version?: string; command?: string } | undefined {
  try {
    const pkgPath = runtimeRequire.resolve('@anthropic-ai/claude-agent-sdk/package.json')
    const version = (runtimeRequire(pkgPath) as { version?: string }).version
    return { version }
  } catch {
    return undefined
  }
}

function bundledRuntime(def: HarnessDefinition): { version?: string; command?: string } | undefined {
  if (def.id === 'claude-code') return bundledClaudeCode()
  return undefined
}

export type HarnessRuntimeComposition = {
  catalog: HarnessCatalog
  detector: HarnessDetector
}

/**
 * Build the harness catalog + detector bound to the live runtime options.
 * Settings overrides are read lazily on every detection pass so config
 * re-apply does not need to rebuild the detector.
 */
export type HarnessSettingsEntry = {
  enabled?: boolean
  binaryPath?: string
  env?: Record<string, string>
  /** Present on custom ACP harness definitions. */
  command?: string
  args?: string[]
  displayName?: string
}

export function createHarnessComposition(
  options: () => Pick<KunServeRuntimeOptions, 'providers'> & {
    harnesses?: Record<string, HarnessSettingsEntry>
  }
): HarnessRuntimeComposition {
  const catalog = new HarnessCatalog({
    custom: () =>
      Object.entries(options().harnesses ?? {})
        .filter(([, entry]) => typeof entry.command === 'string' && entry.command.length > 0)
        .map(([id, entry]) => ({
          id,
          displayName: entry.displayName ?? id,
          command: entry.command!,
          args: entry.args ?? [],
          env: entry.env ?? {}
        }))
  })
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => options().harnesses ?? {},
    bundled: bundledRuntime,
    spawnCaptured,
    probeLogin: (def) =>
      probeHarnessLogin(def, {
        providers: () => (options().providers ?? {}) as Record<string, ServeProviderConfig>
      }),
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  })
  return { catalog, detector }
}
