import type { TomlScalar, TomlTable } from './edit/toml.js'

/**
 * Agent wiring: point another coding agent at Kun's local gateway by editing
 * only the keys Kun owns in that agent's own config, and put back exactly
 * what was there on disconnect.
 */
export type WiringContext = {
  home: string
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  /** Where Kun keeps the stash of original values and saved profiles. */
  stateFile: string
  /** Resolves an executable on PATH (and common install folders). */
  which(bin: string): string | undefined
}

/** One addressable value in an agent's config. */
export type WiringSlot =
  | { file: string; format: 'json'; path: string[] }
  | { file: string; format: 'toml-key'; key: string }
  | { file: string; format: 'toml-table'; table: string }
  | { file: string; format: 'dotenv'; key: string }
  | { file: string; format: 'yaml'; path: string[] }

export type WiringEdit =
  | { slot: WiringSlot; value: unknown }
  /**
   * An array Kun shares with the user (Droid's custom_models): Kun's own
   * entries are replaced and later removed; the user's entries are kept.
   */
  | { slot: Extract<WiringSlot, { format: 'json' | 'yaml' }>; ownedArray: { items: unknown[]; owns(item: unknown): boolean } }

export type GatewayModelInfo = {
  id: string
  displayName?: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoningLevels?: string[]
  reasoning?: boolean
  images?: boolean
}

export type WiringTarget = {
  /** Gateway origin, e.g. http://127.0.0.1:18899 (no /v1). */
  origin: string
  /** Gateway key as the agent should send it (attribution prefix included). */
  key: string
  model: string
  smallModel?: string
  effort?: string
  models: GatewayModelInfo[]
}

export type AgentProtocol = 'anthropic' | 'responses' | 'chat' | 'gemini'

export interface AgentAdapter {
  id: string
  name: string
  protocol: AgentProtocol
  homepage: string
  bins: string[]
  /** Named config files this adapter edits. */
  files(ctx: WiringContext): Record<string, string>
  /** Folders whose existence means the agent has been used on this machine. */
  configDirs(ctx: WiringContext): string[]
  edits(ctx: WiringContext, target: WiringTarget): WiringEdit[]
  /** Reasoning levels the agent can be set to, in Kun's vocabulary. */
  efforts: string[]
  /** Reads which model the agent's config currently names and whether it points at `origin`. */
  inspect(ctx: WiringContext, read: (file: string) => string, origin: string): { model?: string; pointsAtGateway: boolean; key?: string }
  /** The agent reads its config at start-up only. */
  restartRequired: boolean
  /** The agent keeps its own copy of the model list, rewritten on catalog sync. */
  keepsModelList: boolean
  /** Short instruction shown after connecting, when the model is picked inside the agent. */
  pickInAgent?: boolean
  /** For shared arrays: whether an entry is Kun's own (removed on disconnect). */
  ownsArrayItem?(item: unknown): boolean
}

/** `pruneIfEmpty`: a parent object Kun had to create; removed on restore only while empty. */
export type StashedValue = { slot: WiringSlot; absent: boolean; value?: unknown; pruneIfEmpty?: boolean }

export type AgentWiringRecord = {
  connected: boolean
  model?: string
  smallModel?: string
  effort?: string
  clientId?: string
  origin?: string
  connectedAt?: string
  updatedAt?: string
  originals: Record<string, StashedValue>
  createdFiles: string[]
  ownedArrays: { file: string; path: string[]; format?: 'json' | 'yaml' }[]
  /**
   * Per file: whether a pre-connection backup exists and the hash of what Kun
   * last wrote. An untouched file is restored from the backup byte for byte.
   */
  files?: Record<string, { backup: boolean; writtenHash: string }>
}

export type WiringProfile = Record<string, { model: string; smallModel?: string; effort?: string }>

export type WiringState = {
  version: 1
  agents: Record<string, AgentWiringRecord>
  profiles: Record<string, WiringProfile>
}

export type AgentWiringStatus = {
  id: string
  name: string
  protocol: AgentProtocol
  homepage: string
  installed: boolean
  binary?: string
  configFiles: string[]
  connected: boolean
  /** Connected in Kun's records, but the agent's config no longer points at the gateway. */
  drifted: boolean
  model?: string
  smallModel?: string
  effort?: string
  efforts: string[]
  clientId?: string
  restartRequired: boolean
  keepsModelList: boolean
  pickInAgent: boolean
  error?: string
}

export type { TomlScalar, TomlTable }
