import { INPUT_MODALITIES, validateModelInfo, type RemoteFastModeState, type RemoteInputModality, type RemoteModelInfo,
  type RemoteServiceTier } from '@kun/remote-protocol'
import type { HarnessModelInfo } from '../../contracts/harness-models.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import { capabilityFieldKnown } from '../../contracts/model-metadata-evidence.js'
import { resolveModelMetadata } from '../../services/model-metadata-resolver.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'

/** Per listed model of one route: the desktop picker's name, vision badge and Fast toggle state. */
export type ModelInfoMap = Record<string, RemoteModelInfo>
type Provider = Pick<ModelConnectionSnapshot['providers'][number], 'id' | 'presetSource' | 'modelCapabilities'>

/** The desktop composer's Fast mode belongs to Codex connections only, as `composerFastModeState` decides. */
function isCodex(provider: Pick<Provider, 'id' | 'presetSource'>) {
  const preset = provider.presetSource?.trim().toLowerCase()
  return preset === 'codex' || (preset === undefined && provider.id.trim().toLowerCase() === 'codex')
}

/** Known input kinds in wire order; anything else (audio, video…) is not a phone badge. */
function inputs(kinds: readonly string[] | undefined): RemoteInputModality[] | undefined {
  const known = INPUT_MODALITIES.filter((kind) => kinds?.includes(kind))
  return known.length ? known : undefined
}

function entry(displayName: string | undefined, model: string, inputModalities: RemoteInputModality[] | undefined,
  fastMode?: RemoteFastModeState): RemoteModelInfo | undefined {
  const name = displayName?.trim()
  const info: RemoteModelInfo = {
    // The id already shows when the name adds nothing.
    ...(name && name !== model && name.length <= 160 ? { displayName: name } : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(fastMode ? { fastMode } : {})
  }
  return Object.keys(info).length ? info : undefined
}

/** A native Agent's own catalog facts: the name it gives the model and the inputs it reports. */
export function nativeModelInfo(model: string, info: HarnessModelInfo | undefined): RemoteModelInfo | undefined {
  return info ? entry(info.displayName, model, inputs(info.inputModalities)) : undefined
}

function capabilityOf(provider: Provider, model: string) {
  const capabilities = provider.modelCapabilities ?? {}
  if (Object.hasOwn(capabilities, model)) return capabilities[model]
  const key = model.trim().toLowerCase()
  return Object.entries(capabilities).find(([id]) => id.trim().toLowerCase() === key)?.[1]
}

/** The Fast toggle the desktop shows for this provider model; undefined hides it, as it does off Codex. */
export function providerFastMode(provider: Provider, model: string): RemoteFastModeState | undefined {
  if (!isCodex(provider)) return undefined
  const capability = capabilityOf(provider, model)
  const tiers = capability ? resolveModelMetadata(capability).serviceTiers : undefined
  if (!tiers) return 'unknown'
  return tiers.includes('priority') ? 'supported' : 'unsupported'
}

/**
 * A model connection's facts as the desktop picker reads them: a vision or text badge only when the input kinds are
 * known evidence, never an operational default. `fast` is false for an Agent other than Kun, whose loop alone sends tiers.
 */
export function providerModelInfo(provider: Provider, model: string, fast = true): RemoteModelInfo | undefined {
  const capability = capabilityOf(provider, model)
  const resolved = capability ? resolveModelMetadata(capability) : undefined
  const known = resolved && capabilityFieldKnown(resolved, 'inputModalities') ? inputs(resolved.inputModalities) : undefined
  return entry(undefined, model, known, fast ? providerFastMode(provider, model) : undefined)
}

export function routeModelInfo(models: string[], infoOf: (model: string) => RemoteModelInfo | undefined) {
  const entries = models.flatMap((model) => {
    const info = infoOf(model)
    return info ? [[model, info] as const] : []
  })
  return entries.length ? { modelInfo: Object.fromEntries(entries) as ModelInfoMap } : {}
}

/** Self-check before a route leaves the host; a malformed map is withheld, never sent. */
export function checkedModelInfo<T extends { models: string[]; label: string; modelInfo?: ModelInfoMap }>(route: T): T {
  if (!route.modelInfo) return route
  try { return validateModelInfo(route) } catch {
    const { modelInfo: _modelInfo, ...rest } = route
    return rest as T
  }
}

/**
 * Fast mode is a sender preference, as on the desktop composer: a phone's `priority` reaches the turn only when the
 * route that turn runs on (Kun's loop on a Codex connection) is Fast-`supported`, and is dropped otherwise.
 */
export async function fastServiceTier(runtime: ServerRuntime, route: { model?: string; harnessId?: string; providerId?: string },
  requested: RemoteServiceTier | undefined): Promise<RemoteServiceTier | undefined> {
  if (requested !== 'priority' || !route.model || (route.harnessId ?? 'kun') !== 'kun') return undefined
  const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
  const id = route.providerId ?? snapshot?.defaultProviderId
  const provider = snapshot?.providers.find((entry) => entry.id === id)
  return provider && providerFastMode(provider, route.model) === 'supported' ? requested : undefined
}
