import { createHash } from 'node:crypto'
import type { ModelReasoningEffort } from '../contracts/capabilities-core.js'
import type { HarnessModelInfo } from '../contracts/harness-models.js'
import { discoverCursorSdkModels } from '../services/native-provider-model-catalog.js'
import { cursorThinkingControl, type NativeCursorCatalogModel } from '../services/native-cursor-model-metadata.js'
import type { DiscoveredModelDetails, ModelDiscoveryResult } from '../services/provider-model-descriptors.js'

export type CursorCatalogEntry = {
  id: string
  displayName?: string
  description?: string
  /** Concrete levels. Auto is the composer's "do not send a thinking param" choice. */
  reasoningEfforts: string[]
  defaultReasoningEffort?: string
  thinking?: { id: string; values: Partial<Record<ModelReasoningEffort, string>> }
}

export type CursorSubscriptionCatalogSource = {
  list(input: { providerId: string; refresh?: boolean; signal?: AbortSignal }): Promise<CursorCatalogEntry[] | undefined>
}

type CursorCatalogDiscover = (input: {
  apiKey: string
  proxyUrl?: string
  signal?: AbortSignal
}) => Promise<ModelDiscoveryResult>

const cache = new Map<string, CursorCatalogEntry[]>()

function accountKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

export function clearCursorSubscriptionCatalog(): void {
  cache.clear()
}

/** Keep SDK order. Auto is omitted; the picker adds it as "leave the parameter unset". */
export function cursorCatalogEntries(result: Pick<ModelDiscoveryResult, 'models' | 'modelDetails'>): CursorCatalogEntry[] {
  return result.models.flatMap((id) => {
    const details = result.modelDetails?.[id]
    const thinking = cursorThinkingControl(catalogModel(id, details))
    const efforts = (thinking?.supportedEfforts ?? []).filter((effort) => effort !== 'auto')
    return [{
      id,
      ...(details?.displayName ? { displayName: details.displayName } : {}),
      ...(details?.description ? { description: details.description } : {}),
      reasoningEfforts: efforts,
      ...(thinking && thinking.defaultEffort !== 'auto' ? { defaultReasoningEffort: thinking.defaultEffort } : {}),
      ...(thinking && efforts.length ? { thinking: { id: thinking.parameterId, values: thinking.effortMapping } } : {})
    }]
  })
}

export function cursorHarnessModelInfo(
  entries: readonly CursorCatalogEntry[],
  modalities: Readonly<Record<string, readonly string[] | undefined>> = {}
): HarnessModelInfo[] {
  return entries.map((entry) => {
    const inputModalities = modalities[entry.id]?.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
    return {
      id: entry.id,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      reasoningEfforts: [...entry.reasoningEfforts],
      ...(entry.defaultReasoningEffort ? { defaultReasoningEffort: entry.defaultReasoningEffort } : {}),
      ...(inputModalities?.length ? { inputModalities: [...inputModalities] } : {})
    }
  })
}

export function cursorParamsForEffort(
  entries: readonly CursorCatalogEntry[],
  modelId: string,
  effort: string | undefined
): Array<{ id: string; value: string }> | undefined {
  if (!effort || effort === 'auto') return undefined
  const entry = entries.find((item) => item.id === modelId)
  const value = entry?.thinking?.values[effort as ModelReasoningEffort]
  if (!entry?.thinking || !value) return undefined
  return [{ id: entry.thinking.id, value }]
}

/** Account catalog from `Cursor.models.list`, cached by a hash of the key. Failures are not cached. */
export async function loadCursorSubscriptionCatalog(input: {
  apiKey: string
  refresh?: boolean
  signal?: AbortSignal
  proxyUrl?: string
  discover?: CursorCatalogDiscover
}): Promise<CursorCatalogEntry[]> {
  const key = accountKey(input.apiKey)
  if (!input.refresh) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const discover = input.discover ?? discoverCursorSdkModels
  const result = await discover({
    apiKey: input.apiKey,
    signal: input.signal,
    ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {})
  })
  const entries = cursorCatalogEntries(result)
  if (!entries.length) throw new Error('Cursor SDK returned no models')
  cache.set(key, entries)
  return entries
}

/** Thinking `model.params` for one turn. Auto and a cold catalog failure send the model id alone. */
export async function cursorTurnModelParams(input: {
  apiKey: string
  modelId: string
  effort?: string
  signal?: AbortSignal
  discover?: CursorCatalogDiscover
}): Promise<Array<{ id: string; value: string }> | undefined> {
  if (!input.apiKey.trim() || !input.effort || input.effort === 'auto') return undefined
  try {
    const entries = await loadCursorSubscriptionCatalog({
      apiKey: input.apiKey, signal: input.signal, ...(input.discover ? { discover: input.discover } : {})
    })
    return cursorParamsForEffort(entries, input.modelId, input.effort)
  } catch {
    return undefined
  }
}

function catalogModel(id: string, details: DiscoveredModelDetails | undefined): NativeCursorCatalogModel {
  return {
    id,
    displayName: details?.displayName ?? id,
    ...(details?.parameters ? { parameters: details.parameters } : {}),
    ...(details?.variants ? { variants: details.variants } : {})
  }
}
