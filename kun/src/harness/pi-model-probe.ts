import type { HarnessDefinition } from '../contracts/harness.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { probePiHandshake } from './pi-handshake-probe.js'
import { nativeHarnessCredentialEnv, resolveHarnessSecretEnv, type HarnessSecretRefResolver } from './harness-secret-env.js'
import { readinessFingerprint } from './harness-readiness-profile.js'
import { raceProbeAbort } from './probe-abort.js'

/** Pi model discovery uses only get_state/get_available_models; never a prompt. */
export class PiModelProbe {
  private cache = new Map<string, { key: string; models: string[]; expires: number }>()
  constructor(private readonly deps: {
    binaryPath?: (id: string) => string | undefined
    resolveSecretEnv?: HarnessSecretRefResolver
    probe?: typeof probePiHandshake
  } = {}) {}

  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(definition.id)
    return cached && cached.expires > Date.now() && cached.key === this.key(definition) ? cached.models : undefined
  }

  async probe(definition: HarnessDefinition, signal?: AbortSignal): Promise<string[]> {
    const cached = this.peek(definition)
    if (cached) return cached
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)])
    const key = this.key(definition)
    try {
      const secret = await raceProbeAbort(resolveHarnessSecretEnv(definition, this.deps.resolveSecretEnv), bounded)
      const env = { ...definition.launch?.env, ...secret,
        ...nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env, ...secret }) }
      const candidate = this.deps.binaryPath?.(definition.id) ?? definition.launch?.command ?? definition.detect?.command
      if (!candidate) return []
      const command = await raceProbeAbort(resolveExecutable(candidate, { env: { ...harnessExecutableEnv(), ...env } }), bounded)
      if (!command) return []
      const result = await (this.deps.probe ?? probePiHandshake)(definition, command, {
        signal: bounded, env, includeModels: true, resolveSecretEnv: this.deps.resolveSecretEnv
      })
      if (!result.ok || bounded.aborted || this.key(definition) !== key) return []
      const models = result.models ?? []
      this.cache.set(definition.id, { key, models, expires: Date.now() + 60_000 })
      return models
    } catch { return [] }
  }
  private key(definition: HarnessDefinition): string {
    return readinessFingerprint({ options: {}, definition,
      route: { harnessId: definition.id, credentialMode: 'native-login', model: 'default' },
      secretEnv: {}, command: this.deps.binaryPath?.(definition.id) ?? definition.launch?.command })
  }
}
