import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ModelReasoningEffort,
  SubagentProfileConfig,
  SubagentToolPolicy,
  type SubagentMode,
  type SubagentsCapabilityConfig
} from '../contracts/capabilities.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_REVIEWER,
  SandboxModeSchema,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import {
  ChildRunActivity,
  type ChildRunActivity as ChildRunActivityValue,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import {
  applyWorkspaceAgentSurfaceFallback,
  loadWorkspaceAgentProfiles
} from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { AtomicJsonFile, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  ChildRunRecord,
  ChildRoutingMetadata,
  ChildSourceEnvelope,
  ChildSecuritySnapshot,
  profileAvailableOnSurface,
  type ChildReturnFormat,
  type ChildRunExecutor,
  type ChildRunLauncher,
  type ChildRunLifecycleMetadata
} from './delegation-runtime-contracts.js'
import {
  DelegationRuntimeBase,
  type ChildExecutionState,
  type ForegroundChildControl
} from './delegation-runtime-base.js'
import {
  addChildUsage,
  childPptWorkflowSnapshot,
  childActivityFromEvent,
  childContractError,
  childLifecycleMetadata,
  completeModelProviderPair,
  defaultExecutor,
  elapsedMs,
  errorMessage,
  executeWithParentSignal,
  fingerprintProfile,
  isNotFound,
  normalizeInheritedReasoningEffort,
  notifyLifecycle,
  resolveChildModelSelection,
  sameChildActivity,
  sameModelRoute
} from './delegation-runtime-support.js'
import { hasResumableChildSnapshot } from './delegation-proactive-retry.js'

export class DelegationRuntimeRun extends DelegationRuntimeBase {
  async runChild(input: {
    parentThreadId: string
    parentTurnId: string
    /** First-class caller that owns recovery policy for this child. */
    launcher?: ChildRunLauncher
    label?: string
    prompt: string
    /** Exact active parent turn source forwarded by a first-class host. */
    source?: ChildSourceEnvelope
    /** Trusted host workflow control kept outside the child user message. */
    controlPrompt?: string
    pptWorkflowScope?: PptWorkflowScope
    workspace?: string
    model?: string
    providerId?: string
    accountId?: string
    clientSurface?: TurnClientSurface
    /** Effective parent turn/thread model inherited together with inheritedProviderId. */
    inheritedModel?: string
    /** Parent turn/thread provider id inherited by delegate_task when no profile overrides it. */
    inheritedProviderId?: string
    /** Parent account id paired with inheritedProviderId; never credential material. */
    inheritedAccountId?: string
    /** Effective parent-turn reasoning strength inherited by custom one-run agents. */
    inheritedReasoningEffort?: string
    /** Effective parent-turn Codex service tier ('fast'). Inherited by default-inherit tools unless overridden. */
    inheritedServiceTier?: 'priority'
    /**
     * When true, the child falls back to the parent session's model route,
     * reasoning effort, and service tier wherever the profile does not
     * configure an explicit override (explicit tool overrides still win).
     * Used by first-class tools such as `fast_context`; delegate_task
     * keeps its existing precedence semantics when this is unset.
     */
    inheritSessionDefaults?: boolean
    /** Explicit Codex service tier override for this child ('fast' = priority). */
    serviceTier?: 'priority'
    /** Effective parent policy captured by the delegating tool call. */
    approvalPolicy?: ApprovalPolicy
    sandboxMode?: SandboxMode
    approvalReviewer?: ApprovalReviewer
    profile?: string
    /** Trusted, one-run-only profile designed by the parent/router; never persisted as config. */
    inlineProfile?: {
      id: string
      profile: SubagentProfileConfig
      source?: 'builtin' | 'configured' | 'workspace' | 'custom' | 'generated'
    }
    routing?: ChildRoutingMetadata
    agentSurface?: 'code' | 'write' | 'design'
    /** Optional task-level maximum applied after profile resolution. */
    toolPolicyCeiling?: 'readOnly'
    /** Immutable parent capability boundary captured by delegate_task. */
    security?: ChildSecuritySnapshot
    /** Trusted deny-list for this execution only; it is not persisted as child authority. */
    executionBlockedTools?: string[]
    /** Forward GUI design-canvas scope into the child turn when present. */
    guiDesignCanvas?: boolean
    returnFormat?: ChildReturnFormat
    /** Strict budgeted source-only retrieval mode used by Fast Context. */
    fastContext?: boolean
    /** Original task grouping retained in the child record and evidence pack. */
    fastContextTasks?: readonly import('./fast-context-evidence.js').FastContextTask[]
    /** Optional maximum time to wait for an execution slot before failing this child. */
    queueTimeoutMs?: number
    /**
     * When true, runChild returns the queued ChildRunRecord immediately and
     * continues execution in the background. The detached run gets its own
     * AbortController so the user can cancel it via `abortChild(id)` even
     * after the parent turn finishes. Default: false (synchronous).
     */
    detach?: boolean
    /**
     * Invoked once, as soon as the child id is allocated (before the child
     * finishes), so the caller can surface the id while the child is still
     * running — e.g. the delegate_task tool emits a partial result so the GUI
     * can offer "open session" mid-run. Carries the resolved profile id so the
     * caller can keep showing the subagent type while it runs.
     */
    onStart?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => void
    /** Queued and running are distinct states; callbacks are awaited in order. */
    onQueued?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
    onRunning?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    const config = this.options.config
    if (!config.enabled) throw new Error('delegation is disabled by config')
    if (input.signal.aborted) throw new Error('child run aborted before routing completed')
    const security = input.security ? ChildSecuritySnapshot.parse(input.security) : undefined
    const source = input.source ? ChildSourceEnvelope.parse(input.source) : undefined
    const controlPrompt = input.controlPrompt?.trim() || undefined
    // The parent boundary is authoritative. A model/profile cannot replace the
    // workspace-write root by supplying another child working directory.
    const workspace = security?.sandboxRoot ?? input.workspace

    // Resolve the profile up front so model/preamble/tool-policy are
    // captured on the record even if the child later fails.
    if (input.profile?.trim() && input.inlineProfile) {
      throw new Error('profile and inlineProfile are mutually exclusive')
    }
    const inlineProfile = input.inlineProfile
      ? {
          id: input.inlineProfile.id.trim(),
          profile: SubagentProfileConfig.parse(input.inlineProfile.profile),
          source: input.inlineProfile.source
        }
      : undefined
    if (inlineProfile && !inlineProfile.id) throw new Error('inlineProfile.id is required')
    const explicitProfileName = input.profile?.trim() || undefined
    const profileName = inlineProfile?.id ?? explicitProfileName ?? config.defaultProfile
    // Workspace overlay: `.kun/agents/*.md` in the call's workspace wins
    // over the static `config.profiles` map. Loaded fresh per call so the
    // user can edit overlays without restarting the runtime.
    const configuredProfile = profileName && Object.prototype.hasOwnProperty.call(config.profiles, profileName)
      ? config.profiles[profileName]
      : undefined
    let profile: SubagentProfileConfig | undefined = inlineProfile?.profile ?? configuredProfile
    let profileSource = inlineProfile?.source ?? (configuredProfile
      ? BUILTIN_SUBAGENT_PROFILES[profileName ?? ''] === configuredProfile ? 'builtin' as const : 'configured' as const
      : undefined)
    if (!inlineProfile && profileName && workspace) {
      const overlay = await loadWorkspaceAgentProfiles(workspace)
      const hit = overlay.find((entry) => entry.id === profileName)
      if (hit) {
        profile = applyWorkspaceAgentSurfaceFallback(hit, configuredProfile)
        profileSource = 'workspace'
      }
    }
    if (profileName && !profile) {
      throw new Error(`unknown subagent profile: ${profileName}`)
    }
    if (profile?.mode === 'primary') {
      throw new Error(`subagent profile "${profileName}" is primary-session-only`)
    }
    const agentSurface = input.agentSurface ?? 'code'
    if (!inlineProfile && profile && !profileAvailableOnSurface(profile, agentSurface)) {
      throw new Error(`subagent profile "${profileName}" is unavailable on the ${agentSurface} surface`)
    }
    const toolPolicy = input.toolPolicyCeiling === 'readOnly'
      ? 'readOnly'
      : profile?.toolPolicy ?? config.defaultToolPolicy
    // One-run custom/generated roles follow the user's effective session
    // model, provider, and reasoning selection. Model-authored role content
    // must not silently change how the child runs. Reusable profiles keep
    // their trusted configured precedence.
    const ephemeralAgentInheritsSessionSelection =
      profileSource === 'custom' || profileSource === 'generated'
    const selection = resolveChildModelSelection({
      explicitModel: ephemeralAgentInheritsSessionSelection ? undefined : input.model,
      explicitProviderId: ephemeralAgentInheritsSessionSelection ? undefined : input.providerId,
      profileModel: ephemeralAgentInheritsSessionSelection ? undefined : profile?.model,
      profileProviderId: ephemeralAgentInheritsSessionSelection ? undefined : profile?.providerId,
      inheritedModel: input.inheritedModel,
      inheritedProviderId: input.inheritedProviderId
    })
    const resolvedModel = selection.model
    const resolvedProviderId = selection.providerId
    const resolvedAccountId = sameModelRoute(
      selection,
      input.inheritedModel,
      input.inheritedProviderId
    )
      ? input.inheritedAccountId?.trim()
      : undefined
    const approvalReviewer = input.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER
    if (
      resolvedProviderId &&
      security?.allowedModelProviderIds &&
      !security.allowedModelProviderIds.includes(resolvedProviderId)
    ) {
      throw new Error(`child model provider ${resolvedProviderId} expands parent authority`)
    }
    if (
      resolvedModel &&
      security?.allowedModelIds &&
      !security.allowedModelIds.includes(resolvedModel)
    ) {
      throw new Error(`child model ${resolvedModel} expands parent authority`)
    }
    const resolvedSystemPrompt = profile?.systemPrompt
    const resolvedOmitBasePrompt = profile?.omitBasePrompt === true
    const resolvedAllowedTools = profile?.allowedTools
    // Delegation is intentionally one level deep. Enforce this in the host,
    // including for user/workspace profiles that forgot to declare a deny-list.
    const resolvedBlockedTools = [...new Set([
      'delegate_task',
      'generate_subagent',
      ...(profile?.blockedTools ?? []),
      ...(input.executionBlockedTools ?? [])
    ])]
    const resolvedBlockedMcpServers = profile?.blockedMcpServers
    const resolvedBlockedSkills = profile?.blockedSkills
    const resolvedSkillsEnabled = profile?.skillsEnabled ?? true
    const promptPreamble = profile?.promptPreamble
    // Default-inherit tools (e.g. fast_context) follow the parent session's
    // reasoning strength unless the profile configures an explicit depth;
    // reusable delegate_task profiles keep their existing 'off'-style default.
    const resolvedReasoningEffort = ephemeralAgentInheritsSessionSelection
      ? normalizeInheritedReasoningEffort(input.inheritedReasoningEffort)
      : input.inheritSessionDefaults === true
        ? profile?.reasoningEffort ?? normalizeInheritedReasoningEffort(input.inheritedReasoningEffort)
        : profile?.reasoningEffort
    // Explicit tool override wins; otherwise default-inherit tools adopt the
    // parent turn's Codex service tier ('fast'). The child model request is
    // still capability-gated downstream (Codex + priority-capable only).
    const resolvedServiceTier =
      input.serviceTier ??
      (input.inheritSessionDefaults === true ? input.inheritedServiceTier : undefined)
    const returnFormat = input.returnFormat ?? 'summary'
    const clientSurface = input.guiDesignCanvas ? 'gui' : input.clientSurface ?? 'api'

    const queuedAt = this.now()
    const id = this.options.idGenerator?.() ?? `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    let record = ChildRunRecord.parse({
      id,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      agentSurface,
      clientSurface,
      label: input.label,
      prompt: input.prompt,
      ...(source ? { source } : {}),
      workspace,
      model: resolvedModel,
      providerId: resolvedProviderId,
      accountId: resolvedAccountId,
      reasoningEffort: resolvedReasoningEffort,
      ...(resolvedServiceTier ? { serviceTier: resolvedServiceTier } : {}),
      profile: profileName,
      ...(input.routing ? { routing: ChildRoutingMetadata.parse(input.routing) } : {}),
      ...(profile ? { profileSnapshot: profile } : {}),
      ...(profileSource ? { profileSource } : {}),
      ...(profile ? { profileFingerprint: fingerprintProfile(profile) } : {}),
      ...(security ? { security } : {}),
      toolPolicy,
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
      approvalReviewer,
      returnFormat,
      ...(input.fastContext === true ? { fastContext: true } : {}),
      ...(input.fastContextTasks?.length ? { fastContextTasks: [...input.fastContextTasks] } : {}),
      ...(input.detach ? { detached: true } : {}),
      ...(input.launcher ? { launcher: input.launcher } : {}),
      ...(input.pptWorkflowScope
        ? { pptWorkflow: childPptWorkflowSnapshot(input.pptWorkflowScope) }
        : {}),
      status: 'queued',
      resumable: false,
      childSeq: this.nextChildSeq(id),
      createdAt: queuedAt,
      updatedAt: queuedAt
    })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    // Surface allocation as queued. Running is emitted only after a scheduler
    // slot has actually been acquired.
    await notifyLifecycle(input.onQueued, record)
    try {
      input.onStart?.(record.id, profileName, childLifecycleMetadata(record))
    } catch {
      // UI observers cannot prevent or strand an already-persisted child.
    }

    if (input.detach) {
      if (input.signal.aborted) {
        record = ChildRunRecord.parse({
          ...record,
          status: 'aborted',
          terminationReason: 'manual_stop',
          resumable: hasResumableChildSnapshot(record),
          error: 'child run aborted before detached execution started',
          updatedAt: this.now()
        })
        await this.options.store.upsert(record)
        await this.recordChildEvent(record)
        return record
      }
      // Spawn an independent signal so the parent turn's signal aborting
      // doesn't reach into the background run. The user can still cancel
      // via abortChild(id).
      const detachedController = new AbortController()
      this.detachedAborts.set(record.id, detachedController)
      this.detachedParentThreads.set(record.id, input.parentThreadId)
      const logIgnoredParentAbort = (): void => {
        console.warn(`[kun] detached subagent ignored parent abort child=${record.id} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      }
      if (input.signal.aborted) logIgnoredParentAbort()
      else input.signal.addEventListener('abort', logIgnoredParentAbort, { once: true })
      console.warn(`[kun] detached subagent started with independent abort signal child=${record.id} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      const state: ChildExecutionState = { record, commits: Promise.resolve() }
      // Surface ChildRunExecutor's resolved fields via the closure shared with
      // the synchronous path. The same executor block runs inside executeChild.
      const completion = this.executeChild({
        state,
        queuedAt,
        profileName,
        toolPolicy,
        resolvedModel,
        resolvedProviderId,
        resolvedAccountId,
        resolvedSystemPrompt,
        resolvedOmitBasePrompt,
        resolvedAllowedTools,
        resolvedBlockedTools,
        resolvedBlockedMcpServers,
        resolvedBlockedSkills,
        skillsEnabled: resolvedSkillsEnabled,
        promptPreamble,
        approvalPolicy: input.approvalPolicy,
        sandboxMode: input.sandboxMode,
        approvalReviewer,
        clientSurface,
        agentSurface,
        guiDesignCanvas: input.guiDesignCanvas === true,
        resolvedReasoningEffort,
        resolvedServiceTier,
        returnFormat,
        fastContext: input.fastContext === true,
        fastContextTasks: input.fastContextTasks,
        queueTimeoutMs: input.queueTimeoutMs,
        workspace,
        security,
        onRunning: input.onRunning,
        label: input.label,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        prompt: input.prompt,
        source,
        controlPrompt,
        pptWorkflowScope: input.pptWorkflowScope,
        signal: detachedController.signal
      })
        .then((settled) => this.notifyDetachedChild(settled))
        .catch(() => undefined)
        .finally(() => {
          input.signal.removeEventListener('abort', logIgnoredParentAbort)
          this.detachedAborts.delete(record.id)
          this.detachedParentThreads.delete(record.id)
          this.detachedSettlements.delete(record.id)
          console.warn(`[kun] detached subagent finished background tracking child=${record.id}`)
        })
      this.detachedSettlements.set(record.id, completion)
      return record
    }

    const state: ChildExecutionState = { record, commits: Promise.resolve() }
    const controller = new AbortController()
    const abortFromParent = (): void => controller.abort(input.signal.reason)
    if (input.signal.aborted) controller.abort(input.signal.reason)
    else input.signal.addEventListener('abort', abortFromParent, { once: true })
    let resolveDetached = (): void => undefined
    const detached = new Promise<void>((resolve) => { resolveDetached = resolve })
    let resolveDetachedSettlement = (): void => undefined
    const detachedSettlement = new Promise<void>((resolve) => { resolveDetachedSettlement = resolve })
    const control: ForegroundChildControl = {
      state,
      controller,
      parentThreadId: input.parentThreadId,
      unlinkParent: () => input.signal.removeEventListener('abort', abortFromParent),
      resolveDetached,
      detachedSettlement,
      resolveDetachedSettlement
    }
    this.foregroundChildren.set(record.id, control)
    const execution = this.executeChild({
      state,
      queuedAt,
      profileName,
      toolPolicy,
      resolvedModel,
      resolvedProviderId,
      resolvedAccountId,
      resolvedSystemPrompt,
      resolvedOmitBasePrompt,
      resolvedAllowedTools,
      resolvedBlockedTools,
      resolvedBlockedMcpServers,
      resolvedBlockedSkills,
      skillsEnabled: resolvedSkillsEnabled,
      promptPreamble,
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
      approvalReviewer,
      clientSurface,
      agentSurface,
      guiDesignCanvas: input.guiDesignCanvas === true,
      resolvedReasoningEffort,
      resolvedServiceTier,
      returnFormat,
      fastContext: input.fastContext === true,
      fastContextTasks: input.fastContextTasks,
      queueTimeoutMs: input.queueTimeoutMs,
      workspace,
      security,
      onRunning: input.onRunning,
      label: input.label,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      prompt: input.prompt,
      source,
      controlPrompt,
      pptWorkflowScope: input.pptWorkflowScope,
      signal: controller.signal
    })
    const first = await Promise.race([
      execution.then((settled) => ({ kind: 'settled' as const, settled })),
      detached.then(() => ({ kind: 'detached' as const }))
    ])
    if (first.kind === 'settled') {
      control.unlinkParent()
      this.foregroundChildren.delete(record.id)
      return first.settled
    }

    // The tool call is released immediately, while the same child execution
    // continues under the detached controller and reports back on completion.
    control.unlinkParent()
    this.foregroundChildren.delete(record.id)
    void execution
      .then((settled) => this.notifyDetachedChild(settled))
      .catch(() => undefined)
      .finally(() => {
        this.detachedAborts.delete(record.id)
        this.detachedParentThreads.delete(record.id)
        this.detachedSettlements.delete(record.id)
        control.resolveDetachedSettlement()
      })
    return state.record
  }
}
