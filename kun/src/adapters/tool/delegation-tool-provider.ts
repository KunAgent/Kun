import { childSecurity, parentModelRoute } from './delegation-tool-context.js'
import {
  type ChildRoutingMetadata,
  type DelegationRuntime
} from '../../delegation/delegation-runtime.js'
import {
  CustomSubagentDefinitionSchema,
  customSubagentProfile,
  customSubagentProfileId,
  subagentTaskRequiresReadOnly,
  type CustomSubagentDefinition,
  type SubagentRouter
} from '../../delegation/subagent-router.js'
import type { ToolExecutionUpdate, ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import { buildListSubagentProfilesTool } from './delegation-profile-list-tool.js'
import {
  delegateEngineFor,
  delegateRoutingCandidates,
  exclusionNote,
  explicitDelegateProfile
} from './delegation-roster-selection.js'
import type { HarnessRoute } from '../../contracts/harness.js'
import {
  childToolResult,
  existingFallbackMetadata,
  existingRouteMetadata,
  explicitCustomMetadata,
  selectExistingFallback,
  type InlineProfile
} from './delegation-tool-results.js'

const STRUCTURED_SUBAGENT_RESUME_PROMPT = [
  'Continue the interrupted delegated task in this persisted child session.',
  'Review the existing child history and current workspace state, avoid repeating completed work,',
  'and finish the original delegated task or report a concrete blocker.'
].join(' ')

export function buildDelegationToolProviders(
  runtime: DelegationRuntime | undefined,
  router?: SubagentRouter
): CapabilityToolProvider[] {
  if (!runtime?.enabled()) return []
  const useExistingAgents = runtime.useExistingAgents !== false
  const modeProperties = useExistingAgents
    ? {
        profile: {
          type: 'string',
          description: 'Optional exact reusable profile id returned by list_subagent_profiles for a new child. Omit it to route over the effective catalog. On resume, omit it; if repeated, it must match the stored child profile and cannot change the role.'
        }
      }
    : { custom_agent: customAgentSchema() }

  return [{
    id: 'delegation',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'delegate_task',
        description: buildDelegateTaskDescription(runtime),
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'A distinct 2-4 word UI title for a new child. Omit on resume; repeated labels are ignored and the stored title is retained.' },
            prompt: { type: 'string', description: 'The task for the child agent.' },
            resumeChildId: {
              type: 'string',
              description: 'Exact existing interrupted child id to continue. For resume, send only prompt, resumeChildId, and expectedResumeCount. Omit this field entirely for a new child; never send an empty string or a sentinel such as "new".'
            },
            expectedResumeCount: {
              type: 'integer',
              minimum: 0,
              description: 'Last observed resumeCount for stale/double-submit protection. Set only with resumeChildId; omit it entirely for a new child.'
            },
            ...modeProperties,
            detach: {
              type: 'boolean',
              description: 'Run a new child in the background and return after the child is queued. The current turn does not wait for the result; omit this when the result must be consumed before the final answer. Resume runs in the foreground; omit detach or set false.'
            },
            returnFormat: {
              type: 'string', enum: ['summary', 'evidence'],
              description: 'Result format for a new child. Omit on resume; repeated values are ignored and the stored format is retained.'
            }
          },
          required: ['prompt'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context, onUpdate) => {
          const common = parseCommonArgs(args, context)
          if (common instanceof Error) return toolError(common.message)
          const resume = parseResumeArgs(args, context)
          if (resume instanceof Error) return toolError(resume.message)
          if (resume) {
            return await resumeChild(runtime, common, resume, context, onUpdate)
          }
          const requestedProfile = stringValue(args.profile)
          const customAgentSupplied = args.custom_agent !== undefined && args.custom_agent !== null
          let inlineProfile: InlineProfile | undefined
          let routing: ChildRoutingMetadata | undefined
          let engineRoute: HarnessRoute | undefined
          const agentSurface = context.agentSurface ?? 'code'

          if (useExistingAgents && customAgentSupplied) {
            return toolError('custom_agent is unavailable while "Use existing agents" is turned on; select a reusable profile or omit profile for automatic routing')
          }
          if (!useExistingAgents) {
            if (requestedProfile) {
              return toolError('profile is unavailable while "Use existing agents" is turned off; define custom_agent instead')
            }
            if (!customAgentSupplied) {
              return toolError('custom_agent is required while "Use existing agents" is turned off')
            }
          }
          if (!useExistingAgents && customAgentSupplied) {
            const customDefinition = parseCustomAgent(args.custom_agent)
            if (customDefinition instanceof Error) return toolError(customDefinition.message)
            if (!customDefinition) return toolError('custom_agent is required')
            inlineProfile = {
              id: customSubagentProfileId(customDefinition.name),
              profile: customSubagentProfile(customDefinition),
              source: 'custom'
            }
            routing = explicitCustomMetadata(inlineProfile, agentSurface)
          }

          const rosterInput = {
            workspace: common.workspace,
            surface: agentSurface,
            parent: { model: common.inheritedModel, providerId: common.inheritedProviderId }
          }
          if (useExistingAgents && requestedProfile) {
            const selected = await explicitDelegateProfile(runtime, requestedProfile, rosterInput)
            if ('error' in selected) return toolError(selected.error)
            inlineProfile = selected.inlineProfile
            engineRoute = selected.route
            routing = {
              method: 'explicit-profile',
              selectedKind: 'profile',
              selectedId: requestedProfile,
              reason: 'The parent agent explicitly selected this standalone profile.',
              agentSurface,
              candidates: []
            }
          } else if (useExistingAgents && !inlineProfile) {
            const { documents, excluded } = await delegateRoutingCandidates(runtime, rosterInput)
            const route = router
              ? await router.route({
                threadId: context.threadId,
                turnId: context.turnId,
                task: common.prompt,
                agentSurface,
                documents,
                mainModel: common.inheritedModel,
                mainProviderId: common.inheritedProviderId,
                abortSignal: context.abortSignal
              })
              : undefined
            const routedSnapshot = route?.profileId
              ? documents.find((document) => document.id === route.profileId)
              : undefined
            const routedEngine = route && routedSnapshot && !route.generate
              ? await delegateEngineFor(runtime, routedSnapshot.id, rosterInput)
              : undefined
            if (route && routedSnapshot && routedEngine && !('error' in routedEngine)) {
              inlineProfile = {
                id: routedSnapshot.id,
                profile: routedSnapshot.profile,
                source: routedSnapshot.source
              }
              engineRoute = routedEngine.route
              routing = existingRouteMetadata(route, agentSurface)
            } else {
              const lostEngine = routedEngine && 'error' in routedEngine ? routedEngine.error : undefined
              const snapshot = selectExistingFallback(runtime, documents.filter((document) =>
                !lostEngine || document.id !== routedSnapshot?.id))
              if (!snapshot) return toolError('no existing subagent profile is available for delegation')
              const fallbackEngine = await delegateEngineFor(runtime, snapshot.id, rosterInput)
              if ('error' in fallbackEngine) {
                return toolError(`no existing subagent profile can run as a delegate_task child: ${fallbackEngine.error}`)
              }
              inlineProfile = { id: snapshot.id, profile: snapshot.profile, source: snapshot.source }
              engineRoute = fallbackEngine.route
              routing = existingFallbackMetadata(route, snapshot.id, agentSurface)
              if (lostEngine) routing.reason = `${routing.reason ?? ''} The routed role's engine is unavailable: ${lostEngine}.`.trim()
            }
            const note = exclusionNote(excluded)
            if (note) routing.reason = `${routing.reason ?? ''}${note}`.trim().slice(0, 2_000)
          }

          return await runChild(runtime, common, context, onUpdate, {
            ...(inlineProfile ? { inlineProfile } : {}),
            ...(routing ? { routing } : {}),
            ...(engineRoute ? { engineRoute } : {})
          })
        }
      }),
      buildListSubagentProfilesTool(runtime, useExistingAgents)
    ]
  }]
}

function customAgentSchema(): Record<string, unknown> {
  return {
    type: 'object',
    description: 'One-run standalone role written by the parent for a new child. Omit on resume, which retains the stored role. It always inherits the current turn model/provider/reasoning strength, is mutually exclusive with profile, and is retained only in the child-run audit snapshot.',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      system_prompt: { type: 'string', description: 'Self-contained expertise, scope, procedure, output, verification, and boundaries.' },
      tool_policy: { type: 'string', enum: ['readOnly', 'inherit'] },
      blocked_tools: { type: 'array', items: { type: 'string' } }
    },
    required: ['name', 'description', 'system_prompt'],
    additionalProperties: false
  }
}

function parseCommonArgs(args: Record<string, unknown>, context: ToolHostContext): {
  prompt: string
  workspace: string
  inheritedModel?: string
  inheritedProviderId?: string
  inheritedAccountId?: string
  inheritedReasoningEffort?: string
  label?: string
  detach: boolean
  returnFormat?: 'evidence'
} | Error {
  const prompt = stringValue(args.prompt)
  if (!prompt) return new Error('prompt is required')
  return {
    prompt,
    workspace: context.workspace,
    ...(context.actingModelRoute?.model
      ? { inheritedModel: context.actingModelRoute.model }
      : context.model?.id?.trim()
        ? { inheritedModel: context.model.id.trim() }
        : {}),
    ...(context.actingModelRoute?.providerId
      ? { inheritedProviderId: context.actingModelRoute.providerId }
      : context.modelProviderId?.trim()
        ? { inheritedProviderId: context.modelProviderId.trim() }
        : {}),
    ...(context.actingModelRoute?.accountId
      ? { inheritedAccountId: context.actingModelRoute.accountId }
      : {}),
    ...(context.reasoningEffort?.trim() ? { inheritedReasoningEffort: context.reasoningEffort.trim() } : {}),
    ...(stringValue(args.label) ? { label: stringValue(args.label) } : {}),
    detach: args.detach === true,
    ...(args.returnFormat === 'evidence' ? { returnFormat: 'evidence' as const } : {})
  }
}

async function runChild(
  runtime: DelegationRuntime,
  common: Exclude<ReturnType<typeof parseCommonArgs>, Error>,
  context: ToolHostContext,
  onUpdate: ((update: ToolExecutionUpdate) => Promise<void> | void) | undefined,
  selection: { profile?: string; inlineProfile?: InlineProfile; routing?: ChildRoutingMetadata; engineRoute?: HarnessRoute }
): Promise<{ output: Record<string, unknown>; isError: boolean }> {
  const readOnlyTask = subagentTaskRequiresReadOnly(common.prompt)
  const engine = selection.engineRoute
  // A role bound to another engine runs there; a read-only role (or task) runs
  // that engine in its read-only sandbox, since Kun's tool filter cannot reach it.
  const engineFields = engine
    ? {
        harnessId: engine.harnessId,
        credentialMode: engine.credentialMode,
        ...(engine.gatewayBinding ? { gatewayBinding: engine.gatewayBinding } : {}),
        ...(engine.model ? { model: engine.model } : {}),
        ...(engine.providerId ? { providerId: engine.providerId } : {}),
        ...(readOnlyTask || selection.inlineProfile?.profile.toolPolicy === 'readOnly'
          ? { sandboxMode: 'read-only' as const }
          : {})
      }
    : {}
  const record = await runtime.runChild({
    parentThreadId: context.threadId,
    parentTurnId: context.turnId,
    launcher: 'delegate_task',
    prompt: common.prompt,
    workspace: common.workspace,
    ...(common.label ? { label: common.label } : {}),
    ...(selection.profile ? { profile: selection.profile } : {}),
    ...(selection.inlineProfile ? { inlineProfile: selection.inlineProfile } : {}),
    ...(selection.routing ? { routing: selection.routing } : {}),
    agentSurface: context.agentSurface ?? 'code',
    ...(readOnlyTask ? { toolPolicyCeiling: 'readOnly' as const } : {}),
    security: childSecurity(context),
    ...(context.serviceTier ? { inheritedServiceTier: context.serviceTier } : {}),
    ...(common.inheritedModel ? { inheritedModel: common.inheritedModel } : {}),
    ...(common.inheritedProviderId ? { inheritedProviderId: common.inheritedProviderId } : {}),
    ...(common.inheritedAccountId ? { inheritedAccountId: common.inheritedAccountId } : {}),
    ...(common.inheritedReasoningEffort ? { inheritedReasoningEffort: common.inheritedReasoningEffort } : {}),
    approvalPolicy: context.approvalPolicy,
    ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
    approvalReviewer: context.approvalReviewer ?? 'user',
    ...(context.clientSurface ? { clientSurface: context.clientSurface } : {}),
    ...(context.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(context.guiExcalidrawCanvas ? { guiExcalidrawCanvas: true } : {}),
    ...(common.detach ? { detach: true } : {}),
    ...(common.returnFormat ? { returnFormat: common.returnFormat } : {}),
    ...engineFields,
    onQueued: async (childId, profile, metadata) => {
      await onUpdate?.({
        output: {
          childId,
          status: 'queued',
          detached: common.detach,
          ...(profile ? { profile } : {}),
          ...(metadata?.profileName ? { profileName: metadata.profileName } : {}),
          ...(metadata?.model ? { model: metadata.model } : {}),
          ...(metadata?.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {})
        },
        isError: false
      })
    },
    ...(common.detach ? {} : {
      onRunning: async (childId, profile, metadata) => {
        await onUpdate?.({
          output: {
            childId,
            status: 'running',
            detached: false,
            ...(profile ? { profile } : {}),
            ...(metadata?.profileName ? { profileName: metadata.profileName } : {}),
            ...(metadata?.model ? { model: metadata.model } : {}),
            ...(metadata?.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {})
          },
          isError: false
        })
      }
    }),
    signal: context.abortSignal
  })
  return childToolResult(runtime, record)
}

type ResumeArgs = { childId: string; expectedResumeCount?: number; expectedProfile?: string }

function parseResumeArgs(
  args: Record<string, unknown>,
  context: ToolHostContext
): ResumeArgs | undefined | Error {
  const rawChildId = args.resumeChildId
  const childId = stringValue(rawChildId)
  const rawCount = args.expectedResumeCount
  const expectedResumeCount = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 0
    ? rawCount
    : undefined
  if (!childId) {
    if (context.subagentResume) return new Error('this turn must resume the requested child instead of creating a new one')
    const neutralEmptyChildId = typeof rawChildId === 'string' && rawChildId.trim().length === 0
    if (rawChildId !== undefined && !neutralEmptyChildId) {
      return new Error('resumeChildId must be a non-empty string; omit it to create a new child')
    }
    if (rawCount !== undefined && rawCount !== 0) {
      return new Error('expectedResumeCount requires resumeChildId; omit both fields to create a new child')
    }
    return undefined
  }
  if (rawCount !== undefined && expectedResumeCount === undefined) {
    return new Error('expectedResumeCount must be a non-negative integer')
  }
  // Models can echo creation fields or fill optional schema fields on resume.
  // Keep the persisted title/format; treat a repeated profile as an assertion,
  // never as a new route. Neutral placeholders must not prevent continuation.
  const creationOnly = args.custom_agent !== undefined && args.custom_agent !== null
    ? 'custom_agent'
    : args.detach !== undefined && args.detach !== null && args.detach !== false
      ? 'detach'
      : undefined
  if (creationOnly) {
    return new Error(
      `${creationOnly} cannot change during resume; omit ${creationOnly} and keep resumeChildId and expectedResumeCount. ` +
      'Resume the same child with prompt, resumeChildId, and expectedResumeCount only.'
    )
  }
  if (context.subagentResume) {
    if (childId !== context.subagentResume.childId) {
      return new Error(`this turn may only resume child ${context.subagentResume.childId}`)
    }
    if (expectedResumeCount !== context.subagentResume.expectedResumeCount) {
      return new Error(`expectedResumeCount must be ${context.subagentResume.expectedResumeCount}`)
    }
  }
  return {
    childId,
    ...(stringValue(args.profile) ? { expectedProfile: stringValue(args.profile) } : {}),
    ...(expectedResumeCount !== undefined ? { expectedResumeCount } : {})
  }
}

async function resumeChild(
  runtime: DelegationRuntime,
  common: Exclude<ReturnType<typeof parseCommonArgs>, Error>,
  resume: ResumeArgs,
  context: ToolHostContext,
  onUpdate: ((update: ToolExecutionUpdate) => Promise<void> | void) | undefined
): Promise<{ output: Record<string, unknown>; isError: boolean }> {
  try {
    const emit = async (status: 'queued' | 'running', childId: string, profile?: string, metadata?: {
      profileName?: string
      model?: string
      reasoningEffort?: string
    }): Promise<void> => {
      await onUpdate?.({
        output: {
          childId,
          status,
          detached: false,
          ...(profile ? { profile } : {}),
          ...(metadata?.profileName ? { profileName: metadata.profileName } : {}),
          ...(metadata?.model ? { model: metadata.model } : {}),
          ...(metadata?.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {})
        },
        isError: false
      })
    }
    const record = await runtime.resumeChild({
      childId: resume.childId,
      parentThreadId: context.threadId,
      parentTurnId: context.turnId,
      prompt: context.subagentResume ? STRUCTURED_SUBAGENT_RESUME_PROMPT : common.prompt,
      ...(resume.expectedResumeCount !== undefined
        ? { expectedResumeCount: resume.expectedResumeCount }
        : {}),
      ...(resume.expectedProfile ? { expectedProfile: resume.expectedProfile } : {}),
      expectedLaunchers: ['delegate_task'],
      requireResumable: true,
      parentModelRoute: parentModelRoute(context),
      proactive: context.subagentResume === undefined,
      security: childSecurity(context),
      signal: context.abortSignal,
      onQueued: (childId, profile, metadata) => emit('queued', childId, profile, metadata),
      onRunning: (childId, profile, metadata) => emit('running', childId, profile, metadata)
    })
    return childToolResult(runtime, record)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error))
  }
}

function parseCustomAgent(value: unknown): CustomSubagentDefinition | undefined | Error {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Error('custom_agent must be an object')
  const input = value as Record<string, unknown>
  const parsed = CustomSubagentDefinitionSchema.safeParse({
    name: input.name,
    description: input.description,
    systemPrompt: input.system_prompt,
    toolPolicy: input.tool_policy ?? 'readOnly',
    ...(input.blocked_tools !== undefined ? { blockedTools: input.blocked_tools } : {})
  })
  return parsed.success
    ? parsed.data
    : new Error(`invalid custom_agent: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
}

function buildDelegateTaskDescription(runtime: DelegationRuntime): string {
  const modeDescription = runtime.useExistingAgents !== false
    ? 'Select an exact reusable profile id from list_subagent_profiles, or omit profile so Kun can route over the effective catalog. ' +
      'Routed roles can differ per task in tool access (read-only roles cannot edit, and review/investigate-only wording is read-only); ' +
      'pass the same explicit profile to keep tool access identical across a batch. The result reports the applied toolPolicy.'
    : 'Define the best one-run role for this task in custom_agent, including its tool_policy. Do not select or recall an existing profile in this mode.'
  return [
    'Run a standalone child agent and return its result.',
    modeDescription,
    'For a new child, omit resumeChildId and expectedResumeCount entirely; never use empty or "new" sentinel values.',
    'To continue an existing interrupted child, send only prompt, resumeChildId, and expectedResumeCount; omit label, profile, custom_agent, detach, and returnFormat. Resume retains the stored role, title, and result format and never creates a replacement child.',
    'Child model, provider, and reasoning strength remain host-controlled and are not tool-call arguments.',
    'Issue multiple calls in one message only for independent work. Do not start a detached review and then a foreground review for the same scope.',
    `Children default to the "${runtime.defaultToolPolicy}" tool policy and can never recursively delegate.`
  ].join(' ')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toolError(message: string): { output: { error: string }; isError: true } {
  return { output: { error: message }, isError: true }
}
