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
  builtin: boolean
}

export type AdeHarnessStatus = {
  harnessId: string
  installed: 'yes' | 'no' | 'unknown'
  version?: string
  versionSupported?: boolean
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

/** `GET /v1/harnesses/:id/models` response (01 §9). */
export type AdeHarnessModels = {
  harnessId: string
  models: string[]
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
