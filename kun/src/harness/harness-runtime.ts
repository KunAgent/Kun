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
export function createHarnessComposition(
  options: () => Pick<KunServeRuntimeOptions, 'providers' | 'harnesses'>
): HarnessRuntimeComposition {
  const catalog = new HarnessCatalog({
    custom: () => options().harnesses?.custom ?? []
  })
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => {
      const binaryPaths = options().harnesses?.binaryPaths ?? {}
      return Object.fromEntries(
        Object.entries(binaryPaths).map(([id, binaryPath]) => [id, { binaryPath }])
      )
    },
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
