/**
 * Assembles the `query()` options for a kun subscription turn — the glue that
 * injects kun's brain (persona, tools, permissions) into the SDK's loop.
 *
 * The assembly is pure and unit-tested. The two callbacks it carries
 * (`canUseTool`, hook callbacks) are factories that close over kun's real
 * permission/hook engines at the runtime layer; here they are plain injected
 * functions so the wiring is testable with fakes.
 */
import type { ApprovalPolicy } from '../../contracts/policy.js'
import type {
  SdkCanUseTool,
  SdkMcpServerConfig,
  SdkPermissionMode,
  SdkPermissionResult,
  SdkQueryOptions,
  SdkSettingSource,
  SdkSystemPromptPreset
} from './sdk-protocol.js'

/**
 * Claude Code built-in tools we let the model use directly (the overlap set we
 * deliberately did NOT bridge from kun). Listed in allowedTools so they are
 * advertised; gating still flows through canUseTool.
 */
export const DEFAULT_SDK_BUILTIN_TOOLS: readonly string[] = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite'
]

/**
 * Env vars that, if present in the spawned Claude Code process, would override
 * the subscription OAuth token (auth precedence: ANTHROPIC_API_KEY >
 * ANTHROPIC_AUTH_TOKEN > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN). They MUST be
 * stripped or the turn silently bills a pay-as-you-go key / wrong provider.
 */
const AUTH_OVERRIDE_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS'
]

/**
 * Produce a clean env for the SDK's Claude Code subprocess: strip anything that
 * would outrank the subscription token, then inject the token (when provided).
 * When no token is given we rely on the user's existing Claude Code login
 * (~/.claude credentials), so we still strip the overrides but set nothing.
 */
export function buildScopedEnv(
  baseEnv: Record<string, string | undefined>,
  oauthToken?: string
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv }
  for (const key of AUTH_OVERRIDE_ENV_KEYS) delete env[key]
  const token = oauthToken?.trim()
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  return env
}

/**
 * Map kun's ApprovalPolicy onto the SDK permission mode. kun's fine-grained
 * decision still runs per-call via canUseTool; the mode only sets the SDK's
 * default posture.
 *  - plan turn            -> 'plan'
 *  - 'auto' (run all)     -> 'bypassPermissions'
 *  - everything else      -> 'default' (canUseTool adjudicates; 'never' denies)
 */
export function mapApprovalPolicyToPermissionMode(
  policy: ApprovalPolicy,
  planMode = false
): SdkPermissionMode {
  if (planMode) return 'plan'
  if (policy === 'auto') return 'bypassPermissions'
  return 'default'
}

/** Compose kun's persona append text for the claude_code system-prompt preset. */
export function buildClaudeSystemPrompt(
  kunSystemPrompt: string,
  threadPersona?: string
): SdkSystemPromptPreset {
  const base = kunSystemPrompt.trim()
  const persona = threadPersona?.trim()
  const append = persona ? `${base}\n\n${persona}` : base
  return { type: 'preset', preset: 'claude_code', append }
}

export type ToolApprovalDecision =
  | { allow: true; updatedInput?: Record<string, unknown> }
  | { allow: false; message?: string; interrupt?: boolean }

/** kun's permission decision for a (toolName, input) pair on the active turn. */
export type ToolApprovalDecider = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<ToolApprovalDecision> | ToolApprovalDecision

/**
 * Bridge kun's approval engine to the SDK `canUseTool` callback. Every tool the
 * SDK is about to run is adjudicated by kun (which can route to the GUI
 * approval panel). A throwing decider denies closed (fail-safe).
 */
export function buildCanUseTool(decide: ToolApprovalDecider): SdkCanUseTool {
  return async (toolName, input): Promise<SdkPermissionResult> => {
    try {
      const decision = await decide(toolName, input ?? {})
      if (decision.allow) {
        return decision.updatedInput
          ? { behavior: 'allow', updatedInput: decision.updatedInput }
          : { behavior: 'allow' }
      }
      return {
        behavior: 'deny',
        ...(decision.message ? { message: decision.message } : {}),
        ...(decision.interrupt ? { interrupt: true } : {})
      }
    } catch (err) {
      return { behavior: 'deny', message: err instanceof Error ? err.message : 'permission check failed' }
    }
  }
}

export interface AssembleSdkOptionsParams {
  model?: string
  cwd: string
  kunSystemPrompt: string
  threadPersona?: string
  approvalPolicy: ApprovalPolicy
  planMode?: boolean
  /** `mcp__kun__*` names from the tool bridge. */
  bridgedToolModelNames: readonly string[]
  /** Default true: let the model use Claude Code's native read/bash/edit/etc. */
  allowSdkBuiltins?: boolean
  mcpServers?: Record<string, SdkMcpServerConfig>
  canUseTool?: SdkCanUseTool
  hooks?: SdkQueryOptions['hooks']
  agents?: SdkQueryOptions['agents']
  /** Resume a prior SDK session for multi-turn continuity. */
  resume?: string
  baseEnv: Record<string, string | undefined>
  oauthToken?: string
  settingSources?: SdkSettingSource[]
  pathToClaudeCodeExecutable?: string
  abortController?: AbortController
}

export function assembleSdkOptions(params: AssembleSdkOptionsParams): SdkQueryOptions {
  const builtins = params.allowSdkBuiltins === false ? [] : DEFAULT_SDK_BUILTIN_TOOLS
  const allowedTools = [...builtins, ...params.bridgedToolModelNames]
  const options: SdkQueryOptions = {
    cwd: params.cwd,
    systemPrompt: buildClaudeSystemPrompt(params.kunSystemPrompt, params.threadPersona),
    allowedTools,
    permissionMode: mapApprovalPolicyToPermissionMode(params.approvalPolicy, params.planMode),
    includePartialMessages: true,
    env: buildScopedEnv(params.baseEnv, params.oauthToken),
    // Only load kun-provided config; don't auto-absorb the host's ~/.claude.
    settingSources: params.settingSources ?? [],
    ...(params.model ? { model: params.model } : {}),
    ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
    ...(params.canUseTool ? { canUseTool: params.canUseTool } : {}),
    ...(params.hooks ? { hooks: params.hooks } : {}),
    ...(params.agents ? { agents: params.agents } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: params.pathToClaudeCodeExecutable }
      : {}),
    ...(params.abortController ? { abortController: params.abortController } : {})
  }
  return options
}
