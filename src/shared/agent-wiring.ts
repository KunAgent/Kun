import type { AgentWiringStatus, GatewayModelInfo, WiringProfile } from '../../kun/src/agent-wiring/types.js'

export type { AgentWiringStatus, GatewayModelInfo, WiringProfile }

/** Renderer → Main actions for the Agents page. Keys never cross this boundary. */
export type AgentWiringAction =
  | { action: 'list' }
  | { action: 'connect'; agentId: string; model: string; smallModel?: string; effort?: string }
  | { action: 'disconnect'; agentId: string }
  | { action: 'sync' }
  | { action: 'save-profile'; name: string }
  | { action: 'apply-profile'; name: string }
  | { action: 'delete-profile'; name: string }

export type AgentWiringOverview = {
  origin?: string
  gatewayEnabled: boolean
  agents: AgentWiringStatus[]
  models: GatewayModelInfo[]
  profiles: Record<string, WiringProfile>
}

export type AgentWiringResult =
  | ({ ok: true; notice?: string; applied?: string[]; failed?: { agentId: string; error: string }[] } & AgentWiringOverview)
  | { ok: false; error: string; code?: string }

/** Maps a `/v1/model-gateway/catalog` row onto the model facts agent configs can use. */
export function gatewayModelInfo(row: Record<string, unknown>): GatewayModelInfo | null {
  if (typeof row.id !== 'string' || !row.id) return null
  const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  const levels = Array.isArray(row.supported_reasoning_levels)
    ? row.supported_reasoning_levels.map((entry) => (entry as { effort?: unknown }).effort).filter((value): value is string => typeof value === 'string')
    : undefined
  const modalities = row.modalities as { input?: unknown } | undefined
  return {
    id: row.id,
    ...(typeof row.display_name === 'string' ? { displayName: row.display_name } : {}),
    ...(number(row.context_window) ? { contextWindow: number(row.context_window) } : {}),
    ...(number(row.max_output_tokens) ? { maxOutputTokens: number(row.max_output_tokens) } : {}),
    ...(levels?.length ? { reasoningLevels: levels } : {}),
    ...(typeof row.reasoning === 'boolean' ? { reasoning: row.reasoning } : {}),
    ...(Array.isArray(modalities?.input) ? { images: modalities.input.includes('image') } : {})
  }
}
