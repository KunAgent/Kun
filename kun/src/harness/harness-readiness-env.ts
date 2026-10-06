import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessDefinition, HarnessRoute } from '../contracts/harness.js'
import { createAcpCredentialEnv } from '../runtime/acp/acp-credential-env.js'

/** Isolate protocol checks from native login. This sentinel cannot authorize any model request. */
export async function readinessProbeEnvironment(definition: HarnessDefinition, route: HarnessRoute,
  nativeEnv: Record<string, string>): Promise<{ env: Record<string, string>; dispose(): Promise<void> }> {
  if (route.credentialMode !== 'kun-gateway') return { env: nativeEnv, dispose: async () => undefined }
  const gateway = definition.gateway
  if (!gateway) throw new Error('Gateway profile is unsupported')
  const dir = await mkdtemp(join(tmpdir(), 'kun-agent-readiness-'))
  const dispose = () => rm(dir, { recursive: true, force: true })
  const token = 'kun-readiness-no-model-access'
  try {
    const env = ['acp', 'codex-app-server', 'pi-rpc'].includes(definition.transport)
      ? await createAcpCredentialEnv({ tokens: { issue: () => token }, endpoint: () => 'http://127.0.0.1:1', configDir: () => dir,
        resolveAliases: async (binding) => [{ routeId: binding.main.routeId, alias: route.model, role: 'main', targets: [] }]
       })({
        harnessId: definition.id, credentialMode: 'kun-gateway', threadId: 'readiness', turnId: 'readiness',
        credentialIdentity: 'readiness', providerId: route.gatewayBinding ? undefined : route.providerId || 'default',
        gatewayBinding: route.gatewayBinding, model: route.model, gateway
      })
      : { [gateway.env.token]: token, [gateway.env.baseUrl]: 'http://127.0.0.1:1',
        ...(gateway.env.model ? { [gateway.env.model]: route.model } : {}) }
    return { env: { ...definition.launch?.env, ...env }, dispose }
  } catch (error) { await dispose(); throw error }
}
