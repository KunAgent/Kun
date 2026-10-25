import { useEffect } from 'react'
import { create } from 'zustand'
import { AgentRosterEntryViewSchema, agentRosterPath, type AgentRosterEntryView } from '@shared/agent-roster'
import { runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readRuntimeError, readRuntimeJson } from '../agent/kun-runtime-services'

/** Roster listings stay fresh enough for pickers without probing on every render. */
const ROSTER_TTL_MS = 20_000

type RosterSlot = {
  entries: AgentRosterEntryView[]
  loadedAt: number
  loading: boolean
  error?: string
}

type AgentRosterState = {
  slots: Record<string, RosterSlot>
}

export const useAgentRosterStore = create<AgentRosterState>(() => ({ slots: {} }))

const inflight = new Map<string, Promise<void>>()
const EMPTY_SLOT: RosterSlot = { entries: [], loadedAt: 0, loading: false }

function slotKey(workspace: string | undefined): string {
  return workspace?.trim() || ''
}

export async function fetchAgentRoster(workspace?: string): Promise<AgentRosterEntryView[]> {
  const response = await rendererRuntimeClient.runtimeRequest(agentRosterPath({ workspace }), 'GET')
  if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to load the agent roster'))
  const raw = readRuntimeJson<{ entries?: unknown[] }>(response.body, 'Invalid agent roster').entries ?? []
  return raw.flatMap((entry) => {
    const parsed = AgentRosterEntryViewSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** Load (or refresh) the roster for a workspace; concurrent callers share one request. */
export function loadAgentRoster(workspace?: string, force = false): Promise<void> {
  const key = slotKey(workspace)
  const current = useAgentRosterStore.getState().slots[key]
  if (!force && current && !current.error && Date.now() - current.loadedAt < ROSTER_TTL_MS) return Promise.resolve()
  const running = inflight.get(key)
  if (running) return running
  const update = (patch: Partial<RosterSlot>): void => useAgentRosterStore.setState((state) => ({
    slots: { ...state.slots, [key]: { ...(state.slots[key] ?? EMPTY_SLOT), ...patch } }
  }))
  update({ loading: true })
  const task = fetchAgentRoster(key || undefined)
    .then((entries) => update({ entries, loadedAt: Date.now(), loading: false, error: undefined }))
    .catch((error: unknown) => update({ loading: false, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

/** Roster entries for a workspace (global catalog when omitted), loaded on mount. */
export function useAgentRoster(workspace?: string, enabled = true): RosterSlot {
  const key = slotKey(workspace)
  useEffect(() => {
    if (enabled) void loadAgentRoster(key || undefined)
  }, [key, enabled])
  return useAgentRosterStore((state) => state.slots[key]) ?? EMPTY_SLOT
}
