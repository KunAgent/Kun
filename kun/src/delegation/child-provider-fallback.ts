import type { SubagentToolPolicy } from '../contracts/capabilities.js'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '../contracts/policy.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import type { ChildExecutionState } from './delegation-runtime-base.js'
import type {
  ChildRunExecutor, ChildRunRecord, ChildReturnFormat, ChildRunLifecycleMetadata,
  ChildSourceEnvelope, ChildSecuritySnapshot
} from './delegation-runtime-contracts.js'
import { ChildResultExecutionError } from './child-result-materializer.js'

export type ChildExecutionArgs = {
  state: ChildExecutionState
  queuedAt: string
  profileName: string | undefined
  toolPolicy: SubagentToolPolicy
  resolvedModel: string | undefined
  resolvedProviderId: string | undefined
  resolvedAccountId: string | undefined
  resolvedSystemPrompt: string | undefined
  resolvedOmitBasePrompt: boolean
  resolvedAllowedTools: string[] | undefined
  resolvedBlockedTools: string[] | undefined
  resolvedBlockedMcpServers: string[] | undefined
  resolvedBlockedSkills: string[] | undefined
  skillsEnabled: boolean
  promptPreamble: string | undefined
  approvalPolicy: ApprovalPolicy | undefined
  sandboxMode: SandboxMode | undefined
  approvalReviewer: ApprovalReviewer
  clientSurface: TurnClientSurface | undefined
  agentSurface: 'code' | 'write' | 'design' | undefined
  guiDesignCanvas: boolean
  resolvedReasoningEffort: string | undefined
  resolvedServiceTier: 'priority' | undefined
  returnFormat: ChildReturnFormat
  fastContext: boolean
  fastContextTasks: readonly import('./fast-context-evidence.js').FastContextTask[] | undefined
  queueTimeoutMs: number | undefined
  workspace: string | undefined
  security: ChildSecuritySnapshot | undefined
  onRunning: ((childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void) | undefined
  label: string | undefined
  parentThreadId: string
  parentTurnId: string
  prompt: string
  source: ChildSourceEnvelope | undefined
  controlPrompt: string | undefined
  pptWorkflowScope: PptWorkflowScope | undefined
  resumeChild?: boolean
  signal: AbortSignal
}

type ParentRoute = NonNullable<ChildRunRecord['parentModelRoute']>

/** One host-owned continuation in the same session, after the provider's own retries. */
export async function executeWithProviderFallback(
  executor: ChildRunExecutor,
  input: Parameters<ChildRunExecutor>[0],
  record: ChildRunRecord,
  onFallback: (failure: ChildResultExecutionError, route: ParentRoute) => Promise<void>
): ReturnType<ChildRunExecutor> {
  try {
    return await executor(input)
  } catch (error) {
    const route = record.parentModelRoute
    if (
      input.signal.aborted || record.providerFallback || !route ||
      !(error instanceof ChildResultExecutionError) || error.failure?.source !== 'model' ||
      !fallbackRouteAllowed(route, input) ||
      (canonicalProvider(route.providerId) === canonicalProvider(input.providerId) &&
        route.model === input.model)
    ) throw error
    await onFallback(error, route)
    input.signal.throwIfAborted()
    // Append a turn instead of recreating the child: prior tool results and
    // mutations remain authoritative even if the provider failed mid-task.
    const continued = {
      ...input,
      ...route,
      accountId: route.accountId,
      reasoningEffort: route.reasoningEffort,
      serviceTier: route.serviceTier,
      resumeChild: true,
      providerFallbackContinuation: true,
      controlPrompt: [
        input.controlPrompt,
        'The previous model provider failed. Continue the same task using the existing conversation and completed tool results. Do not repeat completed actions.'
      ].filter(Boolean).join('\n\n')
    }
    try {
      const result = await executor(continued)
      return { ...result, toolInvocations: (error.toolInvocations ?? 0) + (result.toolInvocations ?? 0) }
    } catch (fallbackError) {
      if (fallbackError instanceof ChildResultExecutionError) {
        throw new ChildResultExecutionError(fallbackError.message, fallbackError.result, {
          usage: fallbackError.usage ?? error.usage,
          toolInvocations: (error.toolInvocations ?? 0) + (fallbackError.toolInvocations ?? 0),
          failure: fallbackError.failure
        })
      }
      throw fallbackError
    }
  }
}

function fallbackRouteAllowed(
  route: ParentRoute,
  input: Parameters<ChildRunExecutor>[0]
): boolean {
  const security = input.security
  return (!security?.allowedModelProviderIds ||
    security.allowedModelProviderIds.some((id) => canonicalProvider(id) === canonicalProvider(route.providerId))) &&
    (!security?.allowedModelIds || security.allowedModelIds.includes(route.model))
}

function canonicalProvider(providerId: string | undefined): string {
  return providerId?.trim().toLowerCase() || 'default'
}
