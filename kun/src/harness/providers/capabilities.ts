import {
  allSupportedStatuses,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../../contracts/harness-capabilities.js'

const up = (ref: string) => unsupported('upstream', { upstreamRef: ref })
const todo = () => unsupported('not-implemented')

export const KUN_NATIVE_CAPABILITIES: HarnessCapabilities = {
  statuses: allSupportedStatuses(),
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

/**
 * The Claude Code settings.json hook surface. Shared with custom
 * terminal agents that opt into `hooks: 'claude-settings'`.
 */
export const CLAUDE_SETTINGS_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
] as const

const claudeCodeStatuses: HarnessCapabilityStatuses = {
  ...allSupportedStatuses(),
  fork: up('agent sdk has no native session fork'),
  rewind: up('agent sdk has no native session rewind'),
  sameTurnSteer: up('agent sdk query cannot be steered mid-turn'),
  manualCompact: todo(),
  fsMediated: up('agent sdk writes files directly'),
  terminalMediated: up('agent sdk runs commands directly'),
  nativeContextTelemetry: up('agent sdk does not report context usage')
}

export const CLAUDE_CODE_CAPABILITIES: HarnessCapabilities = {
  statuses: claudeCodeStatuses,
  facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' }
}

const cursorStatuses: HarnessCapabilityStatuses = {
  ...allSupportedStatuses(),
  fork: up('cursor sdk has no native session fork'),
  rewind: up('cursor sdk has no native session rewind'),
  sameTurnSteer: up('cursor sdk composer cannot be steered mid-turn'),
  effort: todo(),
  planMode: todo(),
  manualCompact: up('cursor sdk has no manual compaction'),
  nativeToolInterception: up('cursor sdk has no native tool interception'),
  fsMediated: up('cursor sdk writes files directly'),
  terminalMediated: up('cursor sdk runs commands directly'),
  nativeContextTelemetry: up('cursor sdk does not report context usage'),
  nativeCommands: up('cursor sdk has no slash command listing'),
  modes: up('cursor sdk has no mode listing')
}

export const CURSOR_CAPABILITIES: HarnessCapabilities = {
  statuses: cursorStatuses,
  facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' }
}

const antigravityStatuses: HarnessCapabilityStatuses = {
  nativeResume: { supported: true },
  fork: up('antigravity cli has no native session fork'),
  rewind: up('antigravity cli has no native session rewind'),
  structuredStreaming: up('antigravity cli emits final text only'),
  reasoningStream: up('antigravity cli emits final text only'),
  abort: { supported: true },
  sameTurnSteer: up('antigravity cli is one-shot per turn'),
  switchModelMidSession: up('antigravity cli is one-shot per turn'),
  setPermissionModeMidSession: up('antigravity cli is one-shot per turn'),
  effort: up('antigravity cli has no effort control'),
  planMode: up('antigravity cli has no plan mode'),
  manualCompact: up('antigravity cli has no manual compaction'),
  kunTools: up('antigravity cli cannot host kun tools'),
  externalApproval: up('antigravity cli cannot defer approvals'),
  nativeToolInterception: up('antigravity cli tools are not interceptable'),
  fsMediated: up('antigravity cli writes files directly'),
  terminalMediated: up('antigravity cli runs commands directly'),
  nativeContextTelemetry: up('antigravity cli does not report context usage'),
  imageInput: todo(),
  fileInput: { supported: true },
  nativeCommands: up('antigravity cli has no slash command listing'),
  modes: up('antigravity cli has no mode listing'),
  userInput: up('antigravity cli cannot host kun tools')
}

export const ANTIGRAVITY_CAPABILITIES: HarnessCapabilities = {
  statuses: antigravityStatuses,
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
}

/**
 * Static superset for ACP harnesses; the ACP runtime narrows it from the
 * agentCapabilities reported by `initialize`.
 */
export const ACP_DEFAULT_CAPABILITIES: HarnessCapabilities = {
  statuses: {
    ...allSupportedStatuses(),
    fork: up('acp session/fork is not widely implemented'),
    rewind: up('acp session/rewind is not widely implemented'),
    // Guidance joins the run where a concurrent session/prompt does
    // (ProviderAcpHooks.liveSteering); every other engine answers it right
    // after its current prompt, in the same Kun turn.
    sameTurnSteer: { supported: true },
    switchModelMidSession: todo(),
    nativeContextTelemetry: todo(),
    nativeCommands: { supported: true },
    modes: { supported: true }
  },
  facts: { sandbox: 'native', usageReporting: 'estimated', compactionOwner: 'harness' }
}

/**
 * Codex app-server (`codex app-server`, P6): native thread/turn lifecycle,
 * steer/interrupt, fork/rollback, approvals and requestUserInput. Kun Tools
 * MCP and mediated fs/terminal are not wired for this transport yet.
 */
export const CODEX_APP_SERVER_CAPABILITIES: HarnessCapabilities = {
  statuses: {
    ...allSupportedStatuses(),
    fork: { supported: true },
    rewind: { supported: true },
    sameTurnSteer: { supported: true },
    switchModelMidSession: todo(),
    manualCompact: { supported: true },
    kunTools: todo(),
    nativeToolInterception: { supported: true },
    fsMediated: up('codex app-server writes files directly'),
    terminalMediated: up('codex app-server runs commands directly'),
    nativeContextTelemetry: { supported: true },
    nativeCommands: todo(),
    modes: todo()
  },
  facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' }
}


/**
 * Pi rpc (`pi --mode rpc`): native session-file lifecycle
 * (switch_session/fork), steer/follow_up, abort, get_state handshake,
 * get_session_stats usage/context. Approvals ride the generated
 * kun-pi-bridge extension's `tool_call` interception; Kun Tools MCP and
 * mediated fs/terminal are not wired for this transport.
 */
export const PI_RPC_CAPABILITIES: HarnessCapabilities = {
  statuses: {
    ...allSupportedStatuses(),
    // fork(entryId) covers branch-from-earlier-message semantics.
    rewind: { supported: true },
    switchModelMidSession: { supported: true },
    // Bridge re-reads the permission file per tool_call.
    setPermissionModeMidSession: { supported: true },
    effort: { supported: true }, // set_thinking_level
    planMode: todo(),
    manualCompact: { supported: true },
    kunTools: todo(), // Kun-tools MCP bridge not wired yet
    fsMediated: up('pi writes files directly'),
    terminalMediated: up('pi runs commands directly'),
    nativeContextTelemetry: { supported: true }, // get_session_stats.contextUsage
    nativeCommands: todo(),
    modes: todo()
  },
  facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' }
}
