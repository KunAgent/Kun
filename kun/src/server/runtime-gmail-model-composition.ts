import type { DeepSeekAccountEvidenceProof, DeepSeekAccountEvidenceStore } from '../gmail/deepseek-account-evidence.js'
import { assertGoogleWorkspaceModelEndpoint, GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { createGmailThreadDataPolicyOptions } from '../gmail/thread-data-state.js'
import type { GmailModelDataPolicyOptions, GmailModelSelection } from '../gmail/model-data-policy.js'
import type { GmailServicePort } from '../gmail/ports.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { KUN_GMAIL_LOCAL_MODEL, KUN_GMAIL_LOCAL_PROVIDER_ID } from '../adapters/model/verified-local-ollama-model-client.js'
import { buildModelClientRouterInput } from './runtime-factory-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

export type GmailModelClientEvidence = {
  default?: DeepSeekAccountEvidenceProof
  providers: ReadonlyMap<string, DeepSeekAccountEvidenceProof>
}
type CredentialResolver = Parameters<typeof buildModelClientRouterInput>[3]
type ModelConfig = { apiKey: string; credentialSourceId?: string; baseUrl?: string; endpointFormat?: string; kind?: string; headers?: Record<string, string> }

/** Resolve the same protected credential used by normal requests, before constructing transports. */
export async function prepareGmailModelClientEvidence(options: KunServeRuntimeOptions,
  store: Pick<DeepSeekAccountEvidenceStore, 'proof'>, resolveCredentials?: CredentialResolver): Promise<GmailModelClientEvidence> {
  return (await prepareConstructorInputs(options, store, resolveCredentials)).evidence
}

async function prepareConstructorInputs(options: KunServeRuntimeOptions,
  store: Pick<DeepSeekAccountEvidenceStore, 'proof'>, resolveCredentials?: CredentialResolver) {
  const resolutions = new Map<string, Promise<Awaited<ReturnType<NonNullable<CredentialResolver>>>>>()
  const sourceProofs = new Map<string, DeepSeekAccountEvidenceProof>()
  const prepare = async <Config extends ModelConfig>(config: Config): Promise<{ config: Config; proof?: DeepSeekAccountEvidenceProof }> => {
    if (config.kind && config.kind !== 'http') return { config }
    try {
      assertGoogleWorkspaceModelEndpoint(config.baseUrl ?? options.baseUrl, config.endpointFormat ?? options.endpointFormat ?? 'chat_completions')
      const source = config.credentialSourceId
      let resolved: Awaited<ReturnType<NonNullable<CredentialResolver>>> | undefined
      if (source && resolveCredentials) {
        if (!resolutions.has(source)) resolutions.set(source, resolveCredentials(source))
        resolved = await resolutions.get(source)
      }
      const key = source ? resolved?.apiKey : config.apiKey
      if (!key?.trim()) return { config }
      const constructorConfig = { ...config, apiKey: key,
        ...(resolved?.headers ? { headers: { ...config.headers, ...resolved.headers } } : {}) }
      const proof = await store.proof(key).catch(() => undefined)
      if (!proof) return { config: constructorConfig }
      if (source) sourceProofs.set(source, proof)
      // Only this constructor-owned clone carries the resolved key. Active options and public
      // settings still contain their existing source references and never receive the proof.
      return { config: constructorConfig, proof }
    } catch {
      // Unreadable credentials/evidence disable Gmail processing only. Never log credential errors.
      return { config }
    }
  }
  const entries = Object.entries(options.providers ?? {})
  const [preparedDefault, preparedProviders] = await Promise.all([
    prepare(options), Promise.all(entries.map(async ([id, config]) => [id, await prepare(config)] as const))
  ])
  const evidence: GmailModelClientEvidence = { ...(preparedDefault.proof ? { default: preparedDefault.proof } : {}),
    providers: new Map(preparedProviders.flatMap(([id, value]) => id.trim() && value.proof ? [[id.trim(), value.proof] as const] : [])) }
  const constructorOptions = { ...preparedDefault.config,
    ...(options.providers ? { providers: Object.fromEntries(preparedProviders.map(([id, value]) => [id, value.config])) } : {}) }
  const checkedResolver: CredentialResolver = resolveCredentials ? async (sourceId, rejected) => {
    let resolved: Awaited<ReturnType<NonNullable<CredentialResolver>>>
    try { resolved = await resolveCredentials(sourceId, rejected) } catch (error) {
      if (sourceProofs.has(sourceId)) throw new GoogleWorkspaceModelPolicyError('The reviewed DeepSeek API credential is unavailable. Reconnect the model account before using Gmail.')
      throw error
    }
    // Recheck before the account-pinning lease can substitute an old credential. The next
    // configuration rebuild loads fresh evidence, but an already admitted request fails closed.
    sourceProofs.get(sourceId)?.assertCredentials(resolved.apiKey)
    return resolved
  } : undefined
  return { options: constructorOptions, evidence, resolveCredentials: checkedResolver }
}

/** The proof never enters runtime options, settings, HTTP snapshots, or renderer contracts. */
export async function buildGmailModelClientRouterInput(options: KunServeRuntimeOptions,
  capabilities: Parameters<typeof buildModelClientRouterInput>[1],
  store: Pick<DeepSeekAccountEvidenceStore, 'proof'>,
  debug?: Parameters<typeof buildModelClientRouterInput>[2], resolveCredentials?: CredentialResolver,
  registry?: Parameters<typeof buildModelClientRouterInput>[4]) {
  const prepared = await prepareConstructorInputs(options, store, resolveCredentials)
  return buildModelClientRouterInput(prepared.options, capabilities, debug, prepared.resolveCredentials, registry, prepared.evidence)
}

export function createRuntimeGmailModelPolicy(input: {
  threads: ThreadStore; gmail: GmailServicePort; dataDir: string
  fallback: () => GmailModelSelection; localClient?: ModelClient
}): GmailModelDataPolicyOptions {
  const policy = createGmailThreadDataPolicyOptions(input.threads, input.gmail, input.fallback)
  return { ...policy,
    // A concrete cloud transport must still carry its exact host-minted account proof.
    cloudProcessingEnabled: true,
    dataState: async (...args: Parameters<typeof policy.dataState>) => {
      const state = await policy.dataState(...args)
      if (state.sensitive) await assertEncryptedGmailStorage(input.dataDir)
      return state
    },
    ...(input.localClient ? { local: { providerId: KUN_GMAIL_LOCAL_PROVIDER_ID,
      model: KUN_GMAIL_LOCAL_MODEL, client: input.localClient } } : {}) }
}
