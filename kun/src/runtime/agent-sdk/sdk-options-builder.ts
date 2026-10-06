/**
 * Assembles the `query()` options for a kun subscription turn — the glue that
 * injects kun's brain (persona, tools, permissions) into the SDK's loop.
 *
 * The assembly is pure and unit-tested. The two callbacks it carries
 * (`canUseTool`, hook callbacks) are factories that close over kun's real
 * permission/hook engines at the runtime layer; here they are plain injected
 * functions so the wiring is testable with fakes.
 */
import type { ApprovalPolicy, SandboxMode } from '../../contracts/policy.js'
import { isGatewayModelId } from '../../harness/gateway-model-id.js'
import { buildHarnessEnv } from '../../harness/harness-env.js'
import { withLoopbackProxyBypass } from './sdk-process-environment.js'
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
 * deliberately did NOT bridge from kun). They are advertised through `tools`;
 * `allowedTools` is reserved for calls that may bypass `canUseTool`.
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
  'WebFetch'
]

/**
 * Claude Code built-in tools we suppress on the kun-driven SDK path.
 * AskUserQuestion has no UI in this embedding (the model would ask and get no
 * answer); kun's own bridged `user_input` gate handles interactive questions.
 */
export const DEFAULT_SDK_DISALLOWED_TOOLS: readonly string[] = [
  'AskUserQuestion', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'
]

const CLAUDE_OAUTH_TOKEN_PATTERN = /^sk-ant-oat[\w-]+$/

export function normalizeClaudeOAuthToken(raw: string | undefined): string | undefined {
  const token = raw?.trim()
  if (!token) return undefined
  if (!CLAUDE_OAUTH_TOKEN_PATTERN.test(token)) {
    throw new Error(
      'Claude subscription token format is invalid. Paste only the complete sk-ant-oat token value.'
    )
  }
  return token
}

/**
 * Loopback gateway credentials injected into the harness environment for
 * `kun-gateway` credential mode (docs/ade/04 §6). `env` names the variables
 * the harness's protocol expects (`ANTHROPIC_BASE_URL`, ...); `model` and
 * `smallModel` are `kun/<provider>/<model>` direct addresses resolved by the
 * gateway against the grant's routes.
 */
export type SdkGatewayEnv = {
  credentialIdentity?: string
  baseUrl: string
  token: string
  model: string
  smallModel?: string
  env: { baseUrl: string; token: string; model?: string; smallModel?: string }
  stripEnv: readonly string[]
}

/**
 * Produce a clean env for the SDK's Claude Code subprocess: strip anything that
 * would outrank the subscription token, then inject the token (when provided).
 * When no token is given we rely on the user's existing Claude Code login
 * (~/.claude credentials), so we still strip the overrides but set nothing.
 *
 * Gateway mode replaces that entirely: the harness talks to the loopback kun
 * serve gateway, so OAuth and provider credentials are stripped unconditionally
 * and only the gateway base URL/token/model variables are injected.
 */
export function buildScopedEnv(
  baseEnv: Record<string, string | undefined>,
  oauthToken?: string,
  gateway?: SdkGatewayEnv
): Record<string, string | undefined> {
  if (gateway) {
    return buildHarnessEnv({
      base: withLoopbackProxyBypass(baseEnv),
      strip: [...gateway.stripEnv, 'CLAUDE_CODE_OAUTH_TOKEN'],
      add: {
        MAX_THINKING_TOKENS: '0',
        CLAUDE_CODE_EFFORT_LEVEL: 'unset',
        [gateway.env.baseUrl]: gateway.baseUrl,
        [gateway.env.token]: gateway.token,
        ...(gateway.env.model ? { [gateway.env.model]: gateway.model } : {}),
        ...(gateway.env.smallModel && gateway.smallModel
          ? { [gateway.env.smallModel]: gateway.smallModel }
          : {})
      }
    })
  }
  const env = buildHarnessEnv({ base: baseEnv })
  const token = normalizeClaudeOAuthToken(oauthToken)
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
  planMode = false,
  sandboxMode?: SandboxMode
): SdkPermissionMode {
  if (planMode) return 'plan'
  if (policy === 'auto' && sandboxMode === 'danger-full-access') {
    return 'bypassPermissions'
  }
  return 'default'
}

/**
 * Claude Code (the subscription engine) only accepts Anthropic models. A kun
 * thread can carry any provider's model id (e.g. `deepseek-v4-flash` from a
 * thread created while a non-subscription provider was active); passing that to
 * the SDK fails with "model may not exist / no access". Treat a model as
 * SDK-compatible only when it is a Claude id.
 */
export function isAnthropicModel(model: string | undefined): boolean {
  return typeof model === 'string' && /^claude/i.test(model.trim())
}

/**
 * Pick the model to hand the SDK: the thread's own model when it's a Claude id,
 * else the runtime's default Claude model, else undefined (let Claude Code use
 * its built-in default). Guarantees we never send a non-Anthropic id to the SDK.
 * `kun/<provider>/<model>` gateway addresses pass through untouched — the
 * loopback gateway resolves them against the harness grant's routes.
 */
export function resolveSdkModel(
  threadModel: string | undefined,
  defaultModel: string | undefined
): string | undefined {
  if (isGatewayModelId(threadModel)) return threadModel!.trim()
  if (isAnthropicModel(threadModel)) return threadModel!.trim()
  if (isGatewayModelId(defaultModel)) return defaultModel!.trim()
  if (isAnthropicModel(defaultModel)) return defaultModel!.trim()
  return undefined
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
 * SDK is about to run is adjudicated by kun (which can route to the initiating
 * client's approval UI). A throwing decider denies closed (fail-safe).
 */
export function buildCanUseTool(decide: ToolApprovalDecider): SdkCanUseTool {
  return async (toolName, input): Promise<SdkPermissionResult> => {
    const safeInput = input ?? {}
    try {
      const decision = await decide(toolName, safeInput)
      if (decision.allow) {
        // The SDK's runtime schema requires `updatedInput` to be a record on an
        // allow result — its TS type marks it optional, but validation rejects a
        // missing value (seen as a ZodError when the model calls AskUserQuestion).
        // Echo the original input through when kun doesn't rewrite it.
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? safeInput }
      }
      // The deny variant requires a non-empty `message`.
      return {
        behavior: 'deny',
        message: decision.message ?? 'Denied by kun permission policy',
        ...(decision.interrupt ? { interrupt: true } : {})
      }
    } catch (err) {
      return { behavior: 'deny', message: err instanceof Error ? err.message : 'permission check failed' }
    }
  }
}

export interface AssembleSdkOptionsParams {
  model?: string
  reasoningEffort?: string
  cwd: string
  kunSystemPrompt: string
  threadPersona?: string
  approvalPolicy: ApprovalPolicy
  sandboxMode?: SandboxMode
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
  /** Loopback gateway injection for `kun-gateway` turns (overrides oauthToken). */
  gateway?: SdkGatewayEnv
  settingSources?: SdkSettingSource[]
  pathToClaudeCodeExecutable?: string
  abortController?: AbortController
  /** Native Kun maxSteps mapped onto the Agent SDK's loop ceiling. */
  maxTurns?: number
}

export function assembleSdkOptions(params: AssembleSdkOptionsParams): SdkQueryOptions {
  if (params.gateway && params.reasoningEffort && params.reasoningEffort !== 'off') {
    throw new Error('Claude gateway compatibility requires reasoning off; signed thinking is not supported.')
  }
  const builtins = params.allowSdkBuiltins === false ? [] : DEFAULT_SDK_BUILTIN_TOOLS
  const fullAccess =
    params.approvalPolicy === 'auto' &&
    params.sandboxMode === 'danger-full-access'
  // Kun-bridged MCP tools remain safe to auto-allow at the SDK layer because
  // their handler crosses LocalToolHost and performs the real Kun gate. Native
  // tools must stay out of this list in restricted modes: the Agent SDK defines
  // `allowedTools` as execute-without-prompt, which skips `canUseTool`.
  const allowedTools = [
    ...(fullAccess ? builtins : []),
    ...params.bridgedToolModelNames
  ]
  const options: SdkQueryOptions = {
    cwd: params.cwd,
    systemPrompt: buildClaudeSystemPrompt(params.kunSystemPrompt, params.threadPersona),
    // `tools` is the availability boundary; `allowedTools` is only an
    // auto-approval list. Always provide both explicitly so restricted native
    // calls reach `canUseTool`, while dedicated artifact turns expose none.
    tools: [...builtins],
    strictMcpConfig: true,
    allowedTools,
    disallowedTools: [...DEFAULT_SDK_DISALLOWED_TOOLS],
    permissionMode: mapApprovalPolicyToPermissionMode(
      params.approvalPolicy,
      params.planMode,
      params.sandboxMode
    ),
    includePartialMessages: true,
    env: buildScopedEnv(params.baseEnv, params.gateway ? undefined : params.oauthToken, params.gateway),
    // Only load kun-provided config; don't auto-absorb the host's ~/.claude.
    settingSources: params.settingSources ?? [],
    ...(params.model ? { model: params.model } : {}),
    ...(params.gateway ? { thinking: { type: 'disabled' as const } } : sdkReasoningOptions(params.reasoningEffort)),
    ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
    ...(params.canUseTool ? { canUseTool: params.canUseTool } : {}),
    ...(params.hooks ? { hooks: params.hooks } : {}),
    ...(params.agents ? { agents: params.agents } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: params.pathToClaudeCodeExecutable }
      : {}),
    ...(params.abortController ? { abortController: params.abortController } : {}),
    ...(params.maxTurns !== undefined
      ? { maxTurns: Number.isFinite(params.maxTurns) && params.maxTurns > 0
          ? Math.max(1, Math.floor(params.maxTurns))
          : 1 }
      : {})
  }
  return options
}

function sdkReasoningOptions(
  effort: string | undefined
): Pick<SdkQueryOptions, 'effort' | 'thinking'> {
  switch (effort?.trim().toLowerCase()) {
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      return { effort: effort.trim().toLowerCase() as 'low' | 'medium' | 'high' | 'max', thinking: { type: 'adaptive' } }
    case 'auto':
    case 'adaptive':
      return { thinking: { type: 'adaptive' } }
    default:
      return {}
  }
}
