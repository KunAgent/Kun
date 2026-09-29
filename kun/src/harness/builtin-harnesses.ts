import { KUN_TOOL_PERMISSION_MODES } from '../contracts/policy.js'
import { CODEX_APP_SERVER_MIN_VERSION } from '../runtime/codex/codex-protocol.js'
import { PI_MIN_VERSION } from '../runtime/pi/pi-protocol.js'
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

/**
 * The Claude Code settings.json hook surface (05 §6.2). Shared with custom
 * terminal agents that opt into `hooks: 'claude-settings'` (p4 §3.8).
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

export { CODEX_APP_SERVER_MIN_VERSION } from '../runtime/codex/codex-protocol.js'
export { PI_MIN_VERSION } from '../runtime/pi/pi-protocol.js'

/**
 * Pi rpc (`pi --mode rpc`, P6-09): native session-file lifecycle
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
    // Fallback list when the SDK `supportedModels()` probe cannot run;
    // mirrors what Claude Code 2.1.x reports (P3-07).
    staticModels: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5-1',
      'claude-haiku-4-5-20251001'
    ],
    historySource: 'claude-code',
    terminal: {
      argv: [],
      taskFlag: undefined,
      resumeArgs: ['--continue'],
      hooks: {
        kind: 'claude-settings',
        events: [...CLAUDE_SETTINGS_HOOK_EVENTS]
      }
    },
    capabilities: CLAUDE_CODE_CAPABILITIES,
    gateway: {
      protocol: 'anthropic-messages',
      env: {
        baseUrl: 'ANTHROPIC_BASE_URL',
        token: 'ANTHROPIC_AUTH_TOKEN',
        model: 'ANTHROPIC_MODEL',
        smallModel: 'ANTHROPIC_SMALL_FAST_MODEL'
      },
      stripEnv: [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX'
      ]
    },
    setup: {
      install: [
        { platform: 'any', command: 'npm install -g @anthropic-ai/claude-code' },
        {
          platform: 'darwin',
          command: 'curl -fsSL https://claude.ai/install.sh | bash',
          note: 'native installer (also works on Linux)'
        }
      ],
      login: {
        command: 'claude',
        args: [],
        note: 'type /login inside the Claude Code session'
      },
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code'
    },
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
    // Antigravity ships inside the IDE download; there is no standalone
    // package-manager install, so the card links out instead of prefilling.
    setup: { docsUrl: 'https://antigravity.google' },
    builtin: true
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    transport: 'acp',
    // `--acp` is the current flag; `--experimental-acp` still works on older
    // releases but is deprecated upstream (docs/ade/impl/p1 §P1-05).
    detect: { command: 'gemini', aliases: [], versionArgs: ['--version'] },
    launch: { command: 'gemini', args: ['--acp'], env: {} },
    credentialModes: ['native-login'],
    permissionModes: [
      // Gemini CLI approval modes, strictest first.
      { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
      { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' },
      // auto_edit self-approves file edits, which approve-for-me cannot cover.
      { id: 'auto_edit', label: 'Auto edit', kunPermissionMode: 'full-access' },
      { id: 'yolo', label: 'YOLO', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    setup: {
      install: [
        { platform: 'any', command: 'npm install -g @google/gemini-cli' },
        { platform: 'darwin', command: 'brew install gemini-cli' }
      ],
      login: {
        command: 'gemini',
        args: ['auth', 'login'],
        note: 'OAuth sign-in; /auth inside a session switches methods'
      },
      docsUrl: 'https://github.com/google-gemini/gemini-cli'
    },
    builtin: true
  },
  {
    id: 'codex',
    displayName: 'Codex',
    transport: 'acp',
    // `codex acp` requires a TTY; ACP runs through the separate adapter binary.
    detect: {
      command: 'codex-acp',
      aliases: [],
      versionArgs: ['--version'],
      // P3-11: codex present but codex-acp absent is "needs the adapter",
      // not "not installed".
      adapterHint: {
        command: 'codex',
        message:
          'Codex CLI is installed but the ACP adapter codex-acp is missing — ' +
          'install it (npm i -g @zed-industries/codex-acp) to use Codex as a Kun agent'
      }
    },
    launch: { command: 'codex-acp', args: [], env: {} },
    // P6-07: `harnesses.transportOverrides.codex = 'codex-app-server'` (or the
    // P6-08 default flip) selects the native app-server transport — same
    // `codex` binary, no adapter package, native thread/turn lifecycle.
    variants: {
      'codex-app-server': {
        launch: { command: 'codex', args: ['app-server'], env: {} },
        detect: {
          command: 'codex',
          aliases: [],
          versionArgs: ['--version'],
          minVersion: CODEX_APP_SERVER_MIN_VERSION
        },
        capabilities: CODEX_APP_SERVER_CAPABILITIES
      }
    },
    credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [
      // codex-acp adapter modes, strictest first.
      { id: 'read-only', label: 'Read only', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' },
      { id: 'full-access', label: 'Full access', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    historySource: 'codex',
    capabilities: ACP_DEFAULT_CAPABILITIES,
    // Generated CODEX_HOME/config.toml declares a `kun` responses provider
    // (verified against codex 0.145.0 via `codex doctor`, P3-10).
    gateway: {
      protocol: 'openai-responses',
      env: { baseUrl: 'KUN_GATEWAY_BASE_URL', token: 'KUN_GATEWAY_TOKEN' },
      stripEnv: [
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_API_BASE',
        'CODEX_HOME'
      ]
    },
    setup: {
      install: [
        { platform: 'any', command: 'npm install -g @openai/codex' },
        { platform: 'darwin', command: 'brew install --cask codex' }
      ],
      login: { command: 'codex', args: ['login'] },
      adapter: {
        command: 'codex-acp',
        install: 'npm i -g @zed-industries/codex-acp'
      },
      docsUrl: 'https://github.com/openai/codex'
    },
    builtin: true
  },
  {
    id: 'pi',
    displayName: 'Pi',
    transport: 'pi-rpc',
    // pi binds cwd at spawn and hosts one session per process — the shared
    // pool must therefore key on workspace as well as credential (P6-09).
    poolScope: 'workspace',
    detect: {
      command: 'pi',
      aliases: [],
      versionArgs: ['--version'],
      minVersion: PI_MIN_VERSION
    },
    // `--mode rpc --no-extensions --extension <kun-pi-bridge>` are prepended
    // by PiAgent.connect; launch args stay empty so config can't widen them.
    launch: { command: 'pi', args: [], env: {} },
    credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [
      { id: 'ask', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'approve-for-me' },
      { id: 'bypass', label: 'Full access', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    capabilities: PI_RPC_CAPABILITIES,
    // Generated <PI_CODING_AGENT_DIR>/models.json declares a single `kun`
    // provider on the openai-completions surface; the apiKey is a `$NAME`
    // environment reference so the grant token never lands on disk (P6-11).
    gateway: {
      protocol: 'openai-chat',
      env: { baseUrl: 'KUN_PI_GATEWAY_BASE', token: 'KUN_PI_GATEWAY_KEY' },
      stripEnv: [
        'ANTHROPIC_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'DEEPSEEK_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_API_BASE',
        'OPENROUTER_API_KEY',
        'XAI_API_KEY',
        'PI_CODING_AGENT_DIR'
      ]
    },
    setup: {
      install: [
        {
          platform: 'any',
          command: 'npm install -g @earendil-works/pi-coding-agent'
        }
      ],
      // Pi login is the interactive `/login` inside its own TUI.
      login: { command: 'pi', args: [], note: 'Run /login inside pi' },
      docsUrl: 'https://github.com/earendil-works/pi'
    },
    // Hidden until the P6-12 acceptance matrix passes; opt in via the hidden
    // `harnesses.experimentalIds` config.
    prerelease: true,
    builtin: true
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    transport: 'acp',
    detect: { command: 'opencode', aliases: [], versionArgs: ['--version'] },
    launch: { command: 'opencode', args: ['acp'], env: {} },
    credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [
      // OpenCode exposes its agents as session modes; plan is read-only.
      { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
      { id: 'build', label: 'Build', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    historySource: 'opencode',
    capabilities: ACP_DEFAULT_CAPABILITIES,
    // Generated opencode.json pins a single `kun` provider selected via
    // OPENCODE_CONFIG (verified against opencode 1.1.47, P3-10).
    gateway: {
      protocol: 'openai-chat',
      env: { baseUrl: 'KUN_GATEWAY_BASE_URL', token: 'KUN_GATEWAY_TOKEN' },
      stripEnv: [
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_API_BASE',
        'AZURE_OPENAI_API_KEY',
        'DEEPSEEK_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'OPENROUTER_API_KEY',
        'XAI_API_KEY',
        'OPENCODE_CONFIG'
      ]
    },
    setup: {
      install: [
        { platform: 'any', command: 'npm i -g opencode-ai' },
        {
          platform: 'darwin',
          command: 'curl -fsSL https://opencode.ai/install | bash',
          note: 'standalone installer (also works on Linux)'
        }
      ],
      login: { command: 'opencode', args: ['auth', 'login'] },
      docsUrl: 'https://opencode.ai/docs'
    },
    builtin: true
  }
]
