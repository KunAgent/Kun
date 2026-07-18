import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export function buildDelegationToolProviders(runtime: DelegationRuntime | undefined): CapabilityToolProvider[] {
  if (!runtime) return []
  if (!runtime.enabled()) return []
  // Only subagent/all roles are delegation targets; primary-only personas
  // are for starting a session, not for delegate_task.
  const profiles = runtime.listProfiles().filter((profile) => profile.mode !== 'primary')
  const profileNames = profiles.map((profile) => profile.name)
  return [{
    id: 'delegation',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'delegate_task',
        description: buildDelegateTaskDescription(runtime, profiles),
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'A 2-4 word name for this subagent, shown in the UI as its title (e.g. "审查登录流程", "fix failing test", "greet user"). ALWAYS provide it so the user can tell subagents apart, especially when delegating several in parallel. Prefer a distinct label per call.' },
            prompt: { type: 'string', description: 'The task for the child agent.' },
            workspace: { type: 'string' },
            model: { type: 'string', description: 'Override the child model. Must be supplied together with providerId.' },
            providerId: { type: 'string', description: 'Override the child model provider. Must be supplied together with model.' },
            profile: profileNames.length
              ? { type: 'string', enum: profileNames, description: 'Subagent role to apply (model, preamble, tool policy).' }
              : { type: 'string', description: 'Subagent role to apply (model, preamble, tool policy).' },
            detach: {
              type: 'boolean',
              description: 'Fire-and-forget. The call returns immediately with a queued/running record; the child keeps executing in the background and can be checked via diagnostics or aborted from the GUI.'
            },
            tokenBudget: {
              type: 'integer',
              minimum: 1,
              description: 'Optional hard cap for total child tokens.'
            },
            returnFormat: {
              type: 'string',
              enum: ['summary', 'evidence'],
              description: 'Require either a normal summary or explicit evidence items.'
            }
          },
          required: ['prompt'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context, onUpdate) => {
          const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
          if (!prompt) return { output: { error: 'prompt is required' }, isError: true }
          if (args.tokenBudget !== undefined && !isPositiveInteger(args.tokenBudget)) {
            return { output: { error: 'tokenBudget must be a positive integer' }, isError: true }
          }
          const explicitModel = typeof args.model === 'string' ? args.model.trim() : ''
          const explicitProviderId = typeof args.providerId === 'string' ? args.providerId.trim() : ''
          if (Boolean(explicitModel) !== Boolean(explicitProviderId)) {
            return {
              output: { error: 'model and providerId overrides must be supplied together' },
              isError: true
            }
          }
          const inheritedProviderId = context.modelProviderId?.trim()
          const inheritedModel = context.model?.id?.trim()
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: typeof args.label === 'string' ? args.label : undefined,
            prompt,
            workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
            ...(explicitModel ? { model: explicitModel, providerId: explicitProviderId } : {}),
            ...(typeof args.profile === 'string' ? { profile: args.profile } : {}),
            ...(inheritedModel ? { inheritedModel } : {}),
            ...(inheritedProviderId ? { inheritedProviderId } : {}),
            // A child must keep the effective policy of the turn that
            // delegated it, rather than falling back to broader server
            // defaults while queued or detached.
            approvalPolicy: context.approvalPolicy,
            ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
            ...(context.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
            ...(args.detach === true ? { detach: true } : {}),
            ...(isPositiveInteger(args.tokenBudget) ? { tokenBudget: args.tokenBudget } : {}),
            ...(args.returnFormat === 'evidence' ? { returnFormat: 'evidence' as const } : {}),
            // Emit a partial result the moment the child id exists, so the GUI
            // can offer "open session" (and stream the child live) while the
            // child is still running — not only after it completes.
            onStart: (childId, profile) => {
              void onUpdate?.({
                output: {
                  childId,
                  status: 'running',
                  detached: args.detach === true,
                  ...(profile ? { profile } : {})
                },
                isError: false
              })
            },
            signal: context.abortSignal
          })
          return {
            output: {
              childId: record.id,
              status: record.status,
              detached: record.detached === true,
              summary: record.summary,
              error: record.error,
              evidence: record.evidence,
              usage: record.usage,
              returnFormat: record.returnFormat,
              ...(record.tokenBudget ? { tokenBudget: record.tokenBudget } : {}),
              ...(record.budgetExceeded ? { budgetExceeded: record.budgetExceeded } : {}),
              ...(record.profile ? { profile: record.profile } : {}),
              ...(record.toolPolicy ? { toolPolicy: record.toolPolicy } : {}),
              ...(record.toolInvocations !== undefined ? { toolInvocations: record.toolInvocations } : {}),
              ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
              ...(record.queuedMs ? { queuedMs: record.queuedMs } : {})
            },
            isError: record.status === 'failed' || record.status === 'aborted'
          }
        }
      })
    ]
  }]
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function buildDelegateTaskDescription(
  runtime: DelegationRuntime,
  profiles: { name: string; mode: string; toolPolicy: string; model?: string; providerId?: string; description?: string }[]
): string {
  const lines = [
    'Run a child agent task and return its summary.',
    'Issue several delegate_task calls in one message to investigate in parallel; runs queue once the parallel budget is full.',
    `Children default to the "${runtime.defaultToolPolicy}" tool policy (read-only children may only read/grep/find/ls and cannot edit, run shell, or delegate further).`
  ]
  if (profiles.length) {
    const summary = profiles
      .map((profile) => `${profile.name} (${profile.toolPolicy}${profile.model ? `, ${profile.model}` : ''}${profile.providerId ? ` @${profile.providerId}` : ''})${profile.description ? ` — ${profile.description}` : ''}`)
      .join('; ')
    lines.push(`Available profiles: ${summary}.`)
  }
  if (runtime.defaultProfileName) {
    lines.push(`Default profile when omitted: ${runtime.defaultProfileName}.`)
  }
  return lines.join(' ')
}
