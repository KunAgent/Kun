import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../contracts/policy.js'
import type { ApprovalRequest, ApprovalResolution } from '../domain/approval.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type {
  ActingTurnModelRoute,
  SubagentResumeRequest,
  TurnClientSurface
} from '../contracts/turns.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { ExtensionToolCatalogEpoch, KnowledgeBaseMount } from '../contracts/threads.js'
import type {
  UserInputRequest,
  UserInputResolution
} from './user-input-gate.js'

export type ToolProviderKind =
  | 'built-in'
  | 'mcp'
  | 'web'
  | 'skill'
  | 'memory'
  | 'gui'
  | 'delegation'
  | 'image'
  | 'audio'
  | 'video'
  | 'extension'

export type ToolEffects = {
  network: boolean
  externalWrite: boolean
  processExecution: boolean
  guiAutomation: boolean
}

export type ToolProviderPolicy = {
  id: string
  kind: ToolProviderKind
  enabled: boolean
  available: boolean
  reason?: string
  /** Host-authored effects. Omission means unknown and is denied by restricted Graph workers. */
  effects?: ToolEffects
}

/**
 * Optional GUI plan context advertised by the renderer when starting
 * draft or refine plan turns. When present, Kun exposes the
 * `create_plan` tool to the model and gates the corresponding tool
 * adapter to this exact path/workspace. The struct is stable across
 * reconnects so replays reproduce the same gating.
 */
export type GuiPlanContext = {
  /** Operation that triggered the plan tool exposure. */
  operation: 'draft' | 'refine'
  /** Workspace root the plan must be written under. */
  workspaceRoot: string
  /** Reserved plan relative path the tool is allowed to write to. */
  relativePath: string
  /** Stable plan id; matches `GuiPlanArtifact.id` on the GUI side. */
  planId: string
  /** Original user request that originated the plan turn. */
  sourceRequest?: string
  /** Display title for the plan. */
  title?: string
  /** Optional turn id for debugging. */
  turnId?: string
}

export type GuiDesignArtifactContext = {
  kind: 'svg'
  artifactId: string
  relativePath: string
}

export type ApprovedExternalWriteTarget = {
  /** Physical path shown in the approval prompt. */
  path: string
  /** Stable file identity captured before prompting. */
  device: bigint
  inode: bigint
  /** Stable parent-directory identity captured before prompting. */
  parentDevice: bigint
  parentInode: bigint
}

/**
 * Ephemeral proof minted by LocalToolHost after the active call crossed and
 * passed a Kun approval boundary. Callers cannot supply or reuse this proof:
 * the host strips incoming values and binds the replacement to the resolved
 * call name, id, and normalized argument hash.
 */
export type KunActionApprovalGrant = {
  id: string
  source: ApprovalReviewer | 'full-access'
  toolName: string
  callId: string
  argumentsHash: string
  issuedAt: string
  expiresAt: string
}

/**
 * Host-minted capability for one managed PPT child execution. Models cannot
 * supply or persist this scope; PPT-only tools require it at discovery and
 * execution time so the main agent and unrelated children cannot bypass the
 * dedicated workflow host.
 */
export type PptWorkflowScope = Readonly<{
  action: 'start' | 'select_direction' | 'revise_directions' | 'revise_previews' | 'retry_failed' | 'approve_and_build'
  /** Structured output the active child attempt must produce before stopping. */
  stage?: 'direction' | 'review' | 'build'
  workflowId: string
  projectDir: string
  parentThreadId: string
  previewMode: 'image-first' | 'editable'
  /** Work-originated source must be read before the child plans the deck. */
  sourceReadRequired?: boolean
  directionGate?: Readonly<{
    required: boolean
    reason: 'existing-presentation' | 'explicit-skip' | 'work-document' | 'design-reference' | 'complete-visual-system' | 'underspecified-new-deck'
    basis: string
    sourceHash: string
  }>
  directionContext?: Readonly<{
    childId: string
    directions: ReadonlyArray<{
      directionId: string
      revision: number
    }>
    authority: ReadonlyArray<{
      directionId: string
      revision: number
      recommended: boolean
      planFingerprint: string
      candidateFingerprint: string
    }>
    slidesFingerprint: string
  }>
  reviewContext?: Readonly<{
    childId: string
    slides: ReadonlyArray<{
      slideId: string
      revision: number
      annotations?: readonly string[]
    }>
  }>
}>

export type ToolHostContext = {
  threadId: string
  turnId: string
  workspace: string
  /** Pending desktop checkpoint gate for the first workspace mutation. */
  workspaceCheckpointRequestId?: string
  orchestration?: 'direct' | 'graph'
  messageSource?: 'background_shell' | 'background_subagent' | 'graph_runtime' | 'subagent_resume' | 'design_continuation'
  /** Structured child identity bound to a one-click resume turn. */
  subagentResume?: SubagentResumeRequest
  /** Additional explicitly trusted workspace roots for this persisted thread. */
  additionalWorkspaces?: readonly string[]
  /** User-mounted, read-only knowledge sources exposed only through knowledge tools. */
  knowledgeBases?: readonly KnowledgeBaseMount[]
  /** Initiating client surface used to hide providers that require a desktop workbench. */
  clientSurface?: TurnClientSurface
  /**
   * Thread mode advertised by the GUI. Kun restricts plan tools
   * to `plan` threads plus `planDraft`/`planRefine` turn kinds. The
   * field is optional for backward compatibility with older call sites.
   */
  threadMode?: 'agent' | 'plan'
  /** Optional GUI plan context (see above). */
  guiPlan?: GuiPlanContext
  /** True when the active GUI turn is allowed to mutate the design canvas. */
  guiDesignCanvas?: boolean
  /** True only for product Design turns (not Code sidebar canvas turns). */
  guiDesignMode?: boolean
  /** Code is the compatibility default when an older turn omits the field. */
  agentSurface?: 'code' | 'write' | 'design'
  /** Reserved SVG artifact exposed to structured SVG tools for this turn. */
  guiDesignArtifact?: GuiDesignArtifactContext
  /** True when the active turn originated from an IM bridge. */
  imContext?: boolean
  /** Active model capability metadata used by capability-aware providers. */
  model?: ModelCapabilityMetadata
  /**
   * Transient model-visible token allowance for source-tool results in this
   * dispatch. It is derived immediately before execution and is never stored
   * in the session log or exposed in a tool schema.
   */
  sourceResultBudgetTokens?: number
  /**
   * Internal marker for the budgeted Fast Context retrieval child. It is set
   * by AgentLoop context factories only; ordinary agent tool semantics remain
   * unchanged.
   */
  fastContext?: boolean
  /** Stable parent chat thread that owns this retrieval child's source-tool budget. */
  fastContextScopeId?: string
  /** Number of grouped Fast Context tasks; source calls carry task_indexes for durable attribution. */
  fastContextTaskCount?: number
  /** Active model provider id selected for this turn. Child agents inherit this routing unless a profile overrides it. */
  modelProviderId?: string
  /** Frozen model/provider/account route used by automatic approval review. */
  actingModelRoute?: ActingTurnModelRoute
  /** Bounded initiating intent supplied only to the isolated approval reviewer. */
  approvalIntent?: string
  /** Effective reasoning strength selected for this model round. Custom child agents inherit it. */
  reasoningEffort?: string
  /** Effective Codex service tier for this turn ('fast' = priority). Children may inherit it unless a profile/tool overrides it. */
  serviceTier?: 'priority'
  /** Skill ids activated for this turn, if the Skill runtime is enabled. */
  activeSkillIds?: readonly string[]
  /** Optional memory recall/mutation policy for this turn. */
  memoryPolicy?: {
    enabled: boolean
    scopes?: readonly string[]
  }
  /** Optional delegation policy for this turn. */
  delegationPolicy?: {
    enabled: boolean
    maxParallel?: number
  }
  /** Optional model-provider allow-list captured at a delegated child boundary. */
  allowedModelProviderIds?: readonly string[]
  /** Optional model allow-list captured at a delegated child boundary. */
  allowedModelIds?: readonly string[]
  /** Optional provider allow-list. When set, other providers are not advertised or executed. */
  allowedProviderIds?: readonly string[]
  /** Optional tool-name allow-list. When set, other tools are not advertised or executed. */
  allowedToolNames?: readonly string[]
  /** Optional skill-id allow-list. When set, other skills are hidden and cannot be loaded. */
  allowedSkillIds?: readonly string[]
  /** Workspace-relative read scopes captured at a delegated child boundary. */
  allowedReadPaths?: readonly string[]
  /** Workspace-relative write scopes captured at a delegated child boundary. */
  allowedWritePaths?: readonly string[]
  /** Immutable artifact capability set captured at a delegated child boundary. */
  allowedArtifactIds?: readonly string[]
  /** Immutable extension-tool catalog snapshot pinned to this thread boundary. */
  extensionToolCatalogEpoch?: ExtensionToolCatalogEpoch
  /** Optional provider deny-list. Providers listed here are never advertised or executed (deny-list layered on inherit). */
  blockedProviderIds?: readonly string[]
  /** Optional tool-name deny-list. Tools listed here are never advertised or executed (deny-list layered on inherit). */
  blockedToolNames?: readonly string[]
  /** Optional skill-id deny-list for this turn: hides skills from the catalog + auto-activation and rejects `load_skill`. */
  blockedSkillIds?: readonly string[]
  approvalPolicy: ApprovalPolicy
  /** Missing only for legacy/custom callers; runtime contexts always supply `user | agent`. */
  approvalReviewer?: ApprovalReviewer
  /** Filesystem/command sandbox selected for this turn. Defaults at execution time for old callers. */
  sandboxMode?: SandboxMode
  /** Existing physical files approved only for the active tool invocation. */
  approvedExternalWriteTargets?: readonly ApprovedExternalWriteTarget[]
  /** Internal one-call Kun approval proof, visible only while executing the approved tool. */
  kunActionApprovalGrant?: Readonly<KunActionApprovalGrant>
  /** Host-injected active tool-call id. Callers cannot supply or persist it. */
  activeToolCallId?: string
  /** Managed PPT authority injected only into the dedicated PPT child loop. */
  pptWorkflowScope?: PptWorkflowScope
  /** Kun runtime data root; used to allow sandbox-safe reads of background shell output files. */
  runtimeDataDir?: string
  /** Store used to offload oversized tool results from model context. */
  artifactStore?: ArtifactStore
  abortSignal: AbortSignal
  /** Resolves a pending approval with the user's decision. */
  awaitApproval: (
    approval: ApprovalRequest
  ) => Promise<'allow' | 'deny' | ApprovalResolution>
  /** Resolves structured input through the initiating interactive client. */
  awaitUserInput?: (
    input: Omit<UserInputRequest, 'threadId' | 'turnId'>
  ) => Promise<UserInputResolution>
}

export type ToolCallLike = {
  callId: string
  toolName: string
  providerId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments: Record<string, unknown>
}

export type ToolExecutionUpdate = {
  output: unknown
  isError?: boolean
}

export type ToolHostResult = {
  item: TurnItem
  /** True if the call was decided by an approval. */
  approved: boolean
}

/**
 * Port for executing tool calls. The local tool host uses approval
 * boundaries and abort-signal cancellation; a remote host can fan out
 * to a sandboxed environment. The loop and tests only see the port.
 */
export interface ToolHost {
  readonly id: string
  /**
   * List tools available for the current turn. Tool hosts MAY scope
   * the list by mode/client context (e.g. only expose `create_plan`
   * during plan turns) so the model is not tempted to call gated
   * tools in normal agent turns.
   */
  listTools(context?: ToolHostContext): Promise<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    toolKind?: 'tool_call' | 'command_execution' | 'file_change'
    providerId?: string
    providerKind?: ToolProviderKind
  }[]>
  execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult>
  /** Optional runtime hygiene hook used when compaction/discard invalidates read context. */
  clearReadTracker?(threadId?: string): void
}
