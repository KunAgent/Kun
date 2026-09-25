import { KUN_TOOL_PERMISSION_MODES } from '../contracts/policy.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import {
  allSupportedStatuses,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../contracts/harness-capabilities.js'

const up = (ref: string) => unsupported('upstream', { upstreamRef: ref })
const todo = () => unsupported('not-implemented')

export const KUN_NATIVE_CAPABILITIES: HarnessCapabilities = {
  statuses: allSupportedStatuses(),
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

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
  nativeResume: up('antigravity cli has no native session resume'),
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
 * agentCapabilities reported by `initialize` (03 §10).
 */
export const ACP_DEFAULT_CAPABILITIES: HarnessCapabilities = {
  statuses: {
    ...allSupportedStatuses(),
    fork: up('acp session/fork is not widely implemented'),
    rewind: up('acp session/rewind is not widely implemented'),
    sameTurnSteer: up('acp session/prompt does not steer an in-flight turn'),
    switchModelMidSession: todo(),
    nativeContextTelemetry: todo(),
    nativeCommands: { supported: true },
    modes: { supported: true }
  },
  facts: { sandbox: 'native', usageReporting: 'estimated', compactionOwner: 'harness' }
}

export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = [
  {
    id: 'kun',
    displayName: 'Kun',
    transport: 'native-loop',
    credentialModes: ['provider'],
    permissionModes: KUN_TOOL_PERMISSION_MODES.map((mode) => ({
      id: mode,
      label: mode,
      kunPermissionMode: mode
    })),
    modelSource: 'provider',
    staticModels: [],
    capabilities: KUN_NATIVE_CAPABILITIES,
    builtin: true
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    transport: 'agent-sdk',
    detect: { command: 'claude', aliases: [], versionArgs: ['--version'] },
    credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      // acceptEdits writes files without any approval; approve-for-me cannot cover
      // it, so it conservatively maps to full-access.
      { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'full-access' },
      { id: 'bypassPermissions', label: 'Full access', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    historySource: 'claude-code',
    terminal: {
      argv: [],
      taskFlag: undefined,
      resumeArgs: ['--continue'],
      hooks: { kind: 'claude-settings', events: ['Stop', 'Notification', 'PostToolUse'] }
    },
    capabilities: CLAUDE_CODE_CAPABILITIES,
    builtin: true
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    transport: 'cursor-sdk',
    credentialModes: ['provider'],
    permissionModes: [
      { id: 'ask', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto-run', label: 'Auto run', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'provider',
    staticModels: [],
    capabilities: CURSOR_CAPABILITIES,
    builtin: true
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    transport: 'antigravity-cli',
    detect: { command: 'antigravity', aliases: [], versionArgs: ['--version'] },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'provider',
    staticModels: [],
    capabilities: ANTIGRAVITY_CAPABILITIES,
    builtin: true
  }
]
