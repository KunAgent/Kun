import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export function buildDelegationToolProviders(runtime: DelegationRuntime | undefined): CapabilityToolProvider[] {
  if (!runtime) return []
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
            model: { type: 'string', description: 'Override the child model. Defaults to the profile model or server default.' },
            profile: profileNames.length
              ? { type: 'string', enum: profileNames, description: 'Subagent role to apply (model, preamble, tool policy).' }
              : { type: 'string', description: 'Subagent role to apply (model, preamble, tool policy).' },
            detach: {
              type: 'boolean',
              description: 'Fire-and-forget. The call returns immediately with a queued/running record; the child keeps executing in the background and can be checked via diagnostics or aborted from the GUI.'
            }
          },
          required: ['prompt'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context, onUpdate) => {
          const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
          if (!prompt) return { output: { error: 'prompt is required' }, isError: true }
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: typeof args.label === 'string' ? args.label : undefined,
            prompt,
            workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
            ...(typeof args.model === 'string' ? { model: args.model } : {}),
            ...(typeof args.profile === 'string' ? { profile: args.profile } : {}),
            ...(args.detach === true ? { detach: true } : {}),
            // Emit a partial result the moment the child id exists, so the GUI
            // can offer "open session" (and stream the child live) while the
            // child is still running — not only after it completes.
            onStart: (childId, profile) => {
              void onUpdate?.({
                output: { childId, status: 'running', ...(profile ? { profile } : {}) },
                isError: false
              })
            },
            signal: context.abortSignal
          })
          return {
            output: {
              childId: record.id,
              status: record.status,
              summary: record.summary,
              error: record.error,
              usage: record.usage,
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

function buildDelegateTaskDescription(
  runtime: DelegationRuntime,
  profiles: { name: string; mode: string; toolPolicy: string; model?: string; providerId?: string; description?: string }[]
): string {
  const lines = [
    'Run a bounded child agent task and return its summary.',
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
