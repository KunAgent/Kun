/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * Bridged Kun tool execution now lives on the shared transport-independent
 * KunToolBridgeHost (docs/ade/05 §3.2); this module keeps only the SDK-native
 * tool approval seam (`canUseTool`) that has no bridged counterpart.
 */
import type { SdkRuntimeDeps } from './agent-sdk-runtime.js'
import type { ToolApprovalDecision } from './sdk-options-builder.js'
import type { KunToolResult } from './sdk-tool-bridge.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE
} from '../../contracts/policy.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary
} from '../../domain/approval.js'
import { makeDelegatedAwaitApproval } from '../../ade/delegated-approval.js'
import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import type { AgentSdkFactoryContext } from './agent-sdk-runtime-factory-context.js'

const SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep'
])

export function createAgentSdkToolRuntimeDeps(
  deps: AgentSdkRuntimeFactoryDeps,
  context: AgentSdkFactoryContext
): Pick<SdkRuntimeDeps, 'executeKunTool' | 'decideToolApproval'> {
  const { toolBridge } = context
  return {
    async executeKunTool(threadId, turnId, toolName, args, signal, sdkCallId): Promise<KunToolResult> {
      return toolBridge.execute(threadId, turnId, {
        toolName,
        args,
        ...(sdkCallId ? { callId: sdkCallId } : {}),
        signal: signal ?? new AbortController().signal
      })
    },

    async decideToolApproval(threadId, turnId, toolName, input, signal): Promise<ToolApprovalDecision> {
      if (['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'].includes(toolName)) {
        return { allow: false, message: 'SDK-local task state is retired. Use the Kun task_create/task_update/task_get/task_list tools.' }
      }
      // Bridged Kun tools perform their own per-tool policy check through the
      // LocalToolHost context above; asking here too would create two prompts.
      if (toolName.startsWith('mcp__kun__')) return { allow: true }
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (thread?.roomContext || deps.allowSdkBuiltins === false) {
        return { allow: false, message: 'This turn only allows Kun-gated tools.' }
      }
      const approvalPolicy =
        turn?.approvalPolicy ?? thread?.approvalPolicy ?? deps.defaultApprovalPolicy
      if (approvalPolicy === 'never') {
        return { allow: false, message: 'tools are disabled for this turn (policy: never)' }
      }
      // `canUseTool` runs for every SDK-native tool. Preserve the same Kun
      // boundary as LocalToolHost: bounded reads are
      // auto-allowed under on-request/suggest after decideSdkBuiltinSandbox has
      // validated their paths; writes, commands, and network calls still review.
      if (
        (approvalPolicy === 'on-request' || approvalPolicy === 'suggest') &&
        SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS.has(toolName)
      ) {
        return { allow: true }
      }
      const sandboxMode =
        turn?.sandboxMode ?? thread?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE
      const approvalReviewer =
        turn?.approvalReviewer ??
        thread?.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const workspaceCommandApproval =
        toolName === 'Bash' && sandboxMode === 'workspace-write'
      if (approvalPolicy === 'auto' && !workspaceCommandApproval) return { allow: true }
      if (!thread || !turn) {
        return { allow: false, message: 'Acting turn is unavailable; approval failed closed.' }
      }
      const action = createApprovalActionEnvelope({
          toolName,
          providerId: turn.providerId ?? thread.providerId,
          toolKind: toolName === 'Bash'
            ? 'command_execution'
            : ['Write', 'Edit', 'MultiEdit'].includes(toolName)
              ? 'file_change'
              : 'tool_call',
          effects: {
            network: toolName === 'WebSearch' || toolName === 'WebFetch',
            externalWrite: ['Write', 'Edit', 'MultiEdit'].includes(toolName),
            processExecution: toolName === 'Bash',
            guiAutomation: false
          },
          arguments: input,
          workspace: thread.workspace,
          cwd: typeof input.cwd === 'string' ? input.cwd : thread.workspace,
          reason: 'Agent SDK native tool crossed the Kun approval boundary.'
      })
      const approval = createApprovalRequest({
        id: deps.ids.next('appr'),
        threadId,
        turnId,
        toolName,
        summary: safeApprovalActionSummary(action),
        action
      })
      const actingModelRoute = turn.actingModelRoute
      if (!actingModelRoute) {
        return { allow: false, message: 'Acting model route is unavailable; approval failed closed.' }
      }
      const decision = await makeDelegatedAwaitApproval(
        {
          approvalGate: deps.approvalGate,
          approvalReview: deps.approvalReview,
          events: deps.events
        },
        {
          approvalPolicy,
          sandboxMode,
          approvalReviewer,
          actingModelRoute,
          intent: turn.prompt,
          signal: signal ?? new AbortController().signal
        }
      )(approval)
      const resolvedDecision = typeof decision === 'string' ? decision : decision.decision
      return resolvedDecision === 'allow'
        ? { allow: true }
        : {
            allow: false,
            message: typeof decision === 'string'
              ? 'Tool call was denied by the approval policy or user.'
              : decision.reason ?? 'Tool call was denied by the approval reviewer.'
          }
    },
  }
}
