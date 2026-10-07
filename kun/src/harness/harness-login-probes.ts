import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { SpawnCaptured } from './harness-detector.js'
import { sdkProcessBaseEnv } from '../runtime/agent-sdk/sdk-process-environment.js'
import { nativeHarnessCredentialEnv } from './harness-secret-env.js'
import { nativeAgentNetworkEnv } from './native-agent-network.js'
import { providerModule } from './providers/registry.js'

export type HarnessLoginState = HarnessStatus['login']

export type HarnessLoginProbeDeps = {
  /** Provider configs from the active runtime options (read-only). */
  providers: () => Record<string, Pick<ServeProviderConfig, 'kind' | 'credentialSourceId' | 'apiKey' | 'presetSource'>>
  claudeCredentialsPath?: string
  /** Retained for compatibility; Gemini OAuth is not an agy credential. */
  geminiCredentialsPath?: string
  homeDir?: string
  env?: Record<string, string | undefined>
  signal?: AbortSignal
  spawnCaptured?: SpawnCaptured
}

/** Local metadata only. Credential presence never proves authentication. */
export async function probeHarnessLogin(
  def: HarnessDefinition,
  deps: HarnessLoginProbeDeps,
  command?: string
): Promise<HarnessLoginState> {
  deps.signal?.throwIfAborted()
  if (def.id === 'kun') return 'not-required'
  const module = providerModule(def.id)
  const source = { ...(deps.env ?? process.env), ...def.launch?.env }
  const env = { ...sdkProcessBaseEnv(source), ...nativeAgentNetworkEnv(def, source), ...nativeHarnessCredentialEnv(def, source) }
  // Only local configuration pointers accompany the selected native credential.
  for (const key of module?.credentials?.pointerEnvKeys ?? []) {
    if (source[key]) env[key] = source[key]
  }
  const state = module?.login ? await module.login({ definition: def, deps, command, env }) : 'unknown'
  deps.signal?.throwIfAborted()
  return state
}
