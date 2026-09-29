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
  /**
   * Install/login hints for the Agent Center (docs/ade/impl/p4 §3.3). Only
   * builtin definitions carry them, and the UI only ever prefills these into
   * a Kun terminal — nothing is executed automatically.
   */
  setup?: AdeHarnessSetup
}

export type AdeHarnessSetup = {
  install?: {
    platform: 'darwin' | 'linux' | 'win32' | 'any'
    command: string
    note?: string
  }[]
  login?: { command: string; args: string[]; note?: string }
  docsUrl?: string
  /** Adapter package when the CLI cannot serve the transport (codex-acp). */
  adapter?: { command: string; install: string }
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
  /**
   * True while a detection pass is inflight (P4-02): the provisional
   * `unknown` verdicts above are not final, so clients poll instead of
   * pinning the row disabled.
   */
  detecting?: boolean
  /**
   * Stable machine-readable unavailability reason (P4-05). Clients localize
   * a label + next step from this; `message` stays diagnostic detail.
   */
  reasonCode?: AdeHarnessReasonCode
  /** Raw diagnostic detail; render inside a "view reason" disclosure only. */
  message?: string
}

export type AdeHarnessReasonCode =
  | 'disabled'
  | 'not_installed'
  | 'adapter_missing'
  | 'version_too_low'
  | 'handshake_failed'
  | 'handshake_timeout'
  | 'signed_out'

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

/** `POST /v1/harnesses/:id/test` request body (p4 §3.5, P4-10). */
export type AdeHarnessTestRequest = {
  level: 'detect' | 'handshake' | 'trial'
  credentialMode?: AdeHarnessCredentialMode
  providerId?: string
  model?: string
  timeoutMs?: number
}

/** One level's result inside a `testHarness` response. */
export type AdeHarnessTestDetect = {
  durationMs: number
  ok: boolean
  status: AdeHarnessStatus
}

export type AdeHarnessTestHandshake = {
  durationMs: number
  ok: boolean
  /** False when the transport has no handshake surface at all. */
  supported: boolean
  protocol?: string
  protocolVersion?: number
  agent?: { name?: string; version?: string }
  capabilities?: {
    sessionResume?: boolean
    imageInput?: boolean
    mcpTransports?: string[]
  }
  authMethods?: { id: string; name?: string }[]
  authRequired?: boolean
  models?: string[]
  detail?: string
}

export type AdeHarnessTestTrial = {
  durationMs: number
  ok: boolean
  status: 'completed' | 'failed' | 'aborted'
  error?: string
  terminalCode?: string
  usage?: {
    totalTokens: number
    promptTokens?: number
    completionTokens?: number
    model?: string
    providerId?: string
  }
}

export type AdeHarnessTestResult = {
  harnessId: string
  transport: string
  level: 'detect' | 'handshake' | 'trial'
  ok: boolean
  durationMs: number
  detect: AdeHarnessTestDetect
  handshake?: AdeHarnessTestHandshake
  trial?: AdeHarnessTestTrial
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
