import { create } from 'zustand'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessNativeAgent } from '../../../../kun/src/contracts/harness-native-agents'
import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

/**
 * Composer selection of an external harness's native Agent (OpenCode primary
 * agents such as build/plan or user-defined ones). Kept per harness, like the
 * last picked model; an absent entry means "Auto": Kun maps the composer
 * permission level to the native mode.
 */
const STORAGE_KEY = 'kun.harnessNativeAgent.v1'

function load(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readBrowserStorageItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''))
  } catch {
    return {}
  }
}

export const useHarnessNativeAgentStore = create<{ selected: Record<string, string> }>(() => ({ selected: load() }))

export function harnessSupportsNativeAgents(row: AdeHarnessRow | undefined): boolean {
  return row?.definition.nativeAgents === 'session-modes'
}

export function selectedHarnessNativeAgent(harnessId: string | undefined): string | undefined {
  const id = harnessId?.trim()
  return id ? useHarnessNativeAgentStore.getState().selected[id] : undefined
}

/** `undefined` returns the harness to Auto (permission-mapped mode). */
export function selectHarnessNativeAgent(harnessId: string, agentId: string | undefined): void {
  const id = harnessId.trim()
  if (!id || id === 'kun') return
  const selected = { ...useHarnessNativeAgentStore.getState().selected }
  if (agentId?.trim()) selected[id] = agentId.trim()
  else delete selected[id]
  useHarnessNativeAgentStore.setState({ selected })
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(selected))
}

/** Turn-request field for the selected Agent; the runtime ignores harnesses without native Agents. */
export function harnessAgentRequestField(harnessId: string | undefined): { harnessAgentId?: string } {
  const agentId = selectedHarnessNativeAgent(harnessId)
  return agentId ? { harnessAgentId: agentId } : {}
}

/**
 * Agents to offer: the live session's list (it includes workspace-local
 * Agents) wins over the catalog probe; before either answers, the declared
 * permission modes (OpenCode's built-in build/plan) keep the picker usable.
 */
export function nativeAgentOptions(input: {
  row: AdeHarnessRow | undefined
  sessionAgents?: readonly HarnessNativeAgent[]
  catalogAgents?: readonly HarnessNativeAgent[]
}): HarnessNativeAgent[] {
  if (!harnessSupportsNativeAgents(input.row)) return []
  if (input.sessionAgents?.length) return [...input.sessionAgents]
  if (input.catalogAgents?.length) return [...input.catalogAgents]
  return input.row!.definition.permissionModes.map((mode) => ({ id: mode.id, name: mode.label }))
}

export function nativeAgentLabel(agent: HarnessNativeAgent): string {
  const name = agent.name?.trim() || agent.id
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Permission-menu preview while an Agent is picked: it replaces the
 * permission-mapped native mode at every composer level (none is read-only).
 */
export function selectedNativeAgentPreview(row: AdeHarnessRow | undefined): { id: string; label: string; readOnly: boolean } | null {
  if (!harnessSupportsNativeAgents(row)) return null
  const agentId = selectedHarnessNativeAgent(row!.definition.id)
  return agentId ? { id: agentId, label: nativeAgentLabel({ id: agentId }), readOnly: agentId === 'plan' } : null
}
