import { harnessGatewayBindingKey } from '../contracts/harness-gateway-binding.js'
import { createHash } from 'node:crypto'
import { lstatSync, statSync } from 'node:fs'
import type { HarnessEnabledProfile } from '../config/kun-config-harnesses.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { HarnessDefinition, HarnessRoute } from '../contracts/harness.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { nativeHarnessCredentialEnv } from './harness-secret-env.js'
import { nativeAgentNetworkIdentity } from './native-agent-network.js'
import { nativeAgentCredentialFiles, nativeAgentCredentialsConfigured } from './native-agent-credentials.js'
import { providerBinaryEnvKeys, providerModule } from './providers/registry.js'
import { homeOf, readBoundedFile } from './providers/support.js'
import { harnessCommandOverride } from '../config/kun-config-harness-providers.js'

export type ReadinessOptions = Partial<Pick<KunServeRuntimeOptions,
  'providers' | 'routePools' | 'harnesses' | 'apiKey' | 'baseUrl' | 'model' | 'credentialSourceId' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'>>

export function harnessProfile(route: Pick<HarnessRoute, 'harnessId' | 'credentialMode' | 'providerId' | 'gatewayBinding'>): HarnessEnabledProfile {
  if (route.gatewayBinding) return { harnessId: route.harnessId, credentialMode: route.credentialMode, gatewayBinding: route.gatewayBinding }
  return { harnessId: route.harnessId, credentialMode: route.credentialMode,
    ...(route.credentialMode !== 'native-login' ? { providerId: route.providerId?.trim() || 'default' } :
      route.providerId?.trim() && route.providerId.trim() !== 'default' ? { providerId: route.providerId.trim() } : {}) }
}
export function harnessProfileKey(route: Pick<HarnessRoute, 'harnessId' | 'credentialMode' | 'providerId' | 'gatewayBinding'>): string {
  const profile = harnessProfile(route)
  if (profile.gatewayBinding) return JSON.stringify([profile.harnessId, profile.credentialMode, 'alias', harnessGatewayBindingKey(profile.gatewayBinding)])
  return JSON.stringify([profile.harnessId, profile.credentialMode, profile.providerId ?? ''])
}
export function readinessProvider(options: ReadinessOptions, route: HarnessRoute): ServeProviderConfig | undefined {
  if (route.gatewayBinding) return undefined
  const id = route.providerId?.trim() || 'default'
  if (options.providers?.[id]) return options.providers[id]
  if (id !== 'default') return undefined
  const nativeKind = process.env.KUN_RUNTIME_PROVIDER_KIND
  const kind = nativeKind === 'agent-sdk' || nativeKind === 'cursor-sdk' || nativeKind === 'antigravity-cli' ? nativeKind : 'http'
  return { kind, apiKey: options.apiKey ?? '', baseUrl: options.baseUrl,
    credentialSourceId: options.credentialSourceId, selectedModel: options.model }
}

function fileFingerprint(path: string): unknown {
  try {
    const stat = lstatSync(path, { bigint: true })
    return [stat.dev.toString(), stat.ino.toString(), stat.mode.toString(), stat.size.toString(),
      stat.mtimeNs.toString(), stat.ctimeNs.toString(), readBoundedFile(path)]
  } catch { return null }
}
export function nativeCredentialFiles(definition: HarnessDefinition, overrideEnv: Record<string, string> = {}): string[] {
  const env = { ...process.env, ...definition.launch?.env, ...overrideEnv }
  const files = providerModule(definition.id)?.credentials?.files
  return files ? files(env, homeOf(env)) : nativeAgentCredentialFiles(definition.id, env)
}
export function nativeProfileFiles(definition: HarnessDefinition, overrides: Record<string, string> = {}): string[] {
  const env = { ...process.env, ...definition.launch?.env, ...overrides }
  return [...nativeCredentialFiles(definition, overrides),
    ...providerModule(definition.id)?.credentials?.profileFiles?.(env, homeOf(env)) ?? []]
}
/** Only the selected engine's deliberately supported variables cross into its probe. */
export function nativeProfileEnv(definition: HarnessDefinition): Record<string, string> {
  return nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env })
}
/** Configured evidence only; no file, key or database proves an authenticated account. */
export function nativeHasKey(definition: HarnessDefinition, env: Record<string, string>): boolean {
  const merged = { ...process.env, ...definition.launch?.env, ...env }
  const native = Object.fromEntries(Object.entries(merged)
    .filter(([key]) => !/^(?:KUN_|DS_GUI_|DEEPSEEK_GUI_|ELECTRON_|NODE_)/i.test(key)))
  if (nativeAgentCredentialsConfigured(definition.id, native)) return true
  const credentials = providerModule(definition.id)?.credentials
  if (credentials?.evidenceEnvKeys?.some((key) => Boolean(env[key]?.trim()))) return true
  return credentials?.configured?.({ merged, native, selected: env, files: () => nativeCredentialFiles(definition, env) }) === true
}
/** Secret values only enter this digest, never wire responses, logs, or persistent proof. */
export function readinessFingerprint(input: {
  options: ReadinessOptions; definition: HarnessDefinition; route: HarnessRoute;
  secretEnv: Record<string, string>; command?: string
}): string {
  const { options, definition, route } = input
  let binary: unknown
  try { const s = statSync(input.command || harnessCommandOverride(options.harnesses, definition.id) || definition.detect?.command || '');
    binary = [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs] } catch { binary = null }
  return createHash('sha256').update(JSON.stringify({
    definition, route, network: nativeAgentNetworkIdentity(definition),
    binaryPath: harnessCommandOverride(options.harnesses, definition.id), binary,
    runtimeBinaryEnv: [...providerBinaryEnvKeys().map((key) => process.env[key]), process.env.KUN_RUNTIME_PROVIDER_KIND],
    defaults: options.harnesses?.defaults?.[definition.id],
    permissionPolicy: [options.approvalPolicy, options.sandboxMode, options.approvalReviewer],
    engine: providerModule(definition.id)?.credentials?.fingerprint?.({ ...process.env, ...definition.launch?.env, ...input.secretEnv }),
    provider: readinessProvider(options, route), secretEnv: input.secretEnv,
    ...(route.gatewayBinding ? { aliasRouting: {
      pools: options.routePools?.filter((pool) => pool.id === route.gatewayBinding!.main.routeId || pool.id === route.gatewayBinding!.small?.routeId),
      providers: Object.fromEntries([...new Set([...route.gatewayBinding.main.allowedConnectionIds, ...(route.gatewayBinding.small?.allowedConnectionIds ?? [])])]
        .map((id) => [id, options.providers?.[id]]))
    } } : {}),
    env: route.gatewayBinding ? {} : nativeProfileEnv(definition), files: route.gatewayBinding ? [] : nativeProfileFiles(definition, input.secretEnv).map((path) => [path, fileFingerprint(path)])
  })).digest('hex')
}
