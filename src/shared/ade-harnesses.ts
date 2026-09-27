/**
 * Renderer-facing mirror of the /v1/harnesses surface (docs/ade/01 §7,
 * docs/ade/12 §7.2). The wire shape is owned by kun/src/contracts/harness.ts;
 * keep names aligned.
 */

export type AdeHarnessTransport =
  | 'native-loop'
  | 'agent-sdk'
  | 'cursor-sdk'
  | 'antigravity-cli'
  | 'acp'
  | 'terminal'

export type AdeHarnessCredentialMode = 'native-login' | 'provider' | 'kun-gateway'

export type AdeHarnessPermissionMode = {
  /** Harness-native level id, e.g. 'default' | 'bypassPermissions'. */
  id: string
  label: string
  /** Conservative upper bound on Kun's product permission ladder. */
  kunPermissionMode: string
}

export type AdeHarnessDefinition = {
  id: string
  displayName: string
  transport: AdeHarnessTransport
  credentialModes: AdeHarnessCredentialMode[]
  permissionModes: AdeHarnessPermissionMode[]
  modelSource: 'static' | 'probe' | 'provider'
  staticModels: string[]
  /** Existing local-history source this harness can continue (01 §8). */
  historySource?: 'claude-code' | 'codex' | 'opencode'
  /**
   * Tier-0 PTY launch support (docs/ade/05 §6.1). Present only for
   * harnesses that can run inside the built-in terminal.
   */
  terminal?: {
    argv: string[]
    taskFlag?: string
    resumeArgs?: string[]
    hooks?: { kind: string; events: string[] }
  }
  builtin: boolean
}

export type AdeHarnessStatus = {
  harnessId: string
  installed: 'yes' | 'no' | 'unknown'
  version?: string
  versionSupported?: boolean
  /**
   * ACP initialize handshake after the version probe (P3-11): 'no' means the
   * binary exists but cannot serve turns; `message` carries the stderr summary.
   */
  ready?: 'yes' | 'no' | 'unknown'
  login: 'signed-in' | 'signed-out' | 'unknown' | 'not-required'
  resolvedCommand?: string
  checkedAt: string
  /** User-facing reason an entry is unavailable (01 §7.2 CapabilityStatus.message). */
  message?: string
}

/** Row in `GET /v1/harnesses`: definition plus cached detection status. */
export type AdeHarnessRow = {
  definition: AdeHarnessDefinition
  status: AdeHarnessStatus
}

/** Per-provider model group for `provider`/`kun-gateway` credential modes. */
export type AdeHarnessProviderModelGroup = {
  providerId: string
  label: string
  models: string[]
}

/** `GET /v1/harnesses/:id/models` response (01 §9). */
export type AdeHarnessModels = {
  harnessId: string
  models: string[]
  /**
   * Present when `credential_mode=provider|kun-gateway` was requested: the
   * gateway-exposable providers (04 §5.5 `exposableProvider`) with the model
   * ids each can actually serve, grouped for the composer picker.
   */
  credentialMode?: string
  groups?: AdeHarnessProviderModelGroup[]
}

/** A native slash command the harness advertised (03 §7.3). */
export type AdeHarnessCommand = {
  name: string
  description?: string
  inputHint?: string
}

/** Renderer projection of the `harness_session_state` runtime event. */
export type AdeHarnessSessionState = {
  threadId: string
  turnId?: string
  harnessId: string
  commands?: AdeHarnessCommand[]
  currentModeId?: string
}
