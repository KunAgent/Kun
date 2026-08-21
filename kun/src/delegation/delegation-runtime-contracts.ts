import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { applyPosixMode } from '../security/posix-permissions.js'
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
import type { PptWorkflowScope } from '../ports/tool-host.js'
import { ChildRunFailureSchema } from '../contracts/subagent-retry.js'
import { MAX_TURN_ATTACHMENT_IDS } from '../contracts/attachments.js'
import {
  ComposerContextAttachmentSchema,
  MAX_COMPOSER_CONTEXT_ATTACHMENTS
} from '../contracts/composer-context.js'
import { UserFileReferenceSchema } from '../contracts/items.js'
import {
  ChildRunActivity,
  type ChildRunActivity as ChildRunActivityValue,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import { loadWorkspaceAgentProfiles } from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { AtomicJsonFile, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  FastContextEvidencePackSchema,
  FastContextTaskSchema,
  type FastContextEvidencePack,
  type FastContextTask
} from './fast-context-evidence.js'

const ChildRunUsage = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  turns: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional()
})

const ChildReturnFormat = z.enum(['summary', 'evidence'])
export type ChildReturnFormat = z.infer<typeof ChildReturnFormat>

export const ChildResultRef = z.object({
  artifactId: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  mimeType: z.literal('text/markdown')
}).strict()
export type ChildResultRef = z.infer<typeof ChildResultRef>

export const ChildRunLauncher = z.preprocess(
  (value) => (value === 'explore_agent' ? 'fast_context' : value),
  z.enum([
    'delegate_task',
    'fast_context',
    'ppt_agent',
    'component_design',
    'graph'
  ])
)
export type ChildRunLauncher = z.infer<typeof ChildRunLauncher>

export const ChildPptWorkflow = z.object({
  workflowId: z.string().min(1),
  stage: z.enum(['direction', 'review', 'build']),
  previewMode: z.enum(['image-first', 'editable']),
  directionGate: z.object({
    required: z.boolean(),
    reason: z.enum([
      'existing-presentation',
      'explicit-skip',
      'work-document',
      'design-reference',
      'complete-visual-system',
      'underspecified-new-deck'
    ]),
    basis: z.string().trim().min(1).max(240),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict().optional()
}).strict()
export type ChildPptWorkflow = z.infer<typeof ChildPptWorkflow>

export const ChildRunTerminationReason = z.enum([
  'user_stop',
  'manual_stop',
  'runtime_restart',
  'child_error'
])
export type ChildRunTerminationReason = z.infer<typeof ChildRunTerminationReason>

export function isGenericChildLauncher(launcher: ChildRunLauncher | undefined): boolean {
  return launcher === 'delegate_task' || launcher === 'fast_context'
}

/** Fast Context results are evidence snapshots, not resumable work sessions. */
export function isResumableChildRun(input: Pick<ChildRunRecord, 'launcher' | 'fastContext'>): boolean {
  return input.fastContext !== true && isGenericChildLauncher(input.launcher)
}

/**
 * Exact user-authored turn source forwarded into a child. Host-owned control
 * instructions deliberately live outside this envelope so they cannot replace
 * or amend the child user message.
 */
export const ChildSourceEnvelope = z.object({
  prompt: z.string().min(1),
  displayText: z.string().optional(),
  attachmentIds: z.array(z.string().min(1)).max(MAX_TURN_ATTACHMENT_IDS).default([]),
  composerContexts: z.array(ComposerContextAttachmentSchema)
    .max(MAX_COMPOSER_CONTEXT_ATTACHMENTS)
    .default([]),
  fileReferences: z.array(UserFileReferenceSchema).default([]),
  agentSurface: z.enum(['code', 'write', 'design']).optional()
}).strict()
export type ChildSourceEnvelope = z.infer<typeof ChildSourceEnvelope>

export const ChildSecuritySnapshot = z.object({
  /** Immutable parent workspace boundary; also used as the child working directory. */
  sandboxRoot: z.string().min(1),
  allowedModelProviderIds: z.array(z.string().min(1)).optional(),
  allowedModelIds: z.array(z.string().min(1)).optional(),
  allowedProviderIds: z.array(z.string().min(1)).optional(),
  allowedToolNames: z.array(z.string().min(1)).optional(),
  allowedSkillIds: z.array(z.string().min(1)).optional(),
  allowedReadPaths: z.array(z.string().min(1)).optional(),
  allowedWritePaths: z.array(z.string().min(1)).optional(),
  allowedArtifactIds: z.array(z.string().min(1)).optional(),
  blockedProviderIds: z.array(z.string().min(1)).optional(),
  blockedToolNames: z.array(z.string().min(1)).optional(),
  blockedSkillIds: z.array(z.string().min(1)).optional(),
  /** Whether workspace/global AGENTS instructions may enter this child. */
  instructionsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().default(false)
}).strict()
export type ChildSecuritySnapshot = z.infer<typeof ChildSecuritySnapshot>

export const ChildRoutingMetadata = z.object({
  method: z.enum([
    'explicit-profile',
    'explicit-skill',
    'explicit-custom',
    'explicit-generated',
    'bm25-llm-profile',
    'bm25-llm-skill',
    'bm25-llm-custom',
    'bm25-llm-generated',
    'bm25-fallback-profile',
    'bm25-fallback-skill',
    'bm25-fallback-custom',
    'bm25-fallback-generated'
  ]),
  selectedKind: z.enum(['profile', 'skill', 'custom', 'generated']),
  selectedId: z.string().min(1),
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  reason: z.string().max(2_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  candidates: z.array(z.object({
    kind: z.enum(['profile', 'skill']),
    targetId: z.string().min(1),
    name: z.string().min(1).max(256),
    description: z.string().max(2_000).optional(),
    toolPolicy: SubagentToolPolicy.optional(),
    source: z.enum(['builtin', 'configured', 'workspace', 'skill']),
    score: z.number().nonnegative()
  }).strict()).max(5).default([]),
  /** Snapshot of a one-shot custom role. It is never merged into persistent config. */
  customAgent: SubagentProfileConfig.optional(),
  generation: z.object({
    method: z.enum(['llm-exemplars', 'deterministic-fallback']),
    referenceAgentIds: z.array(z.string().min(1)).max(3),
    reason: z.string().max(2_000)
  }).strict().optional()
}).strict()
export type ChildRoutingMetadata = z.infer<typeof ChildRoutingMetadata>

export function profileAvailableOnSurface(
  profile: Pick<SubagentProfileConfig, 'surfaces'>,
  surface: 'code' | 'write' | 'design'
): boolean {
  const surfaces = profile.surfaces ?? ['shared']
  return surfaces.includes('shared') || surfaces.includes(surface)
}

export const ChildRunRecord = z.object({
  id: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1),
  agentSurface: z.enum(['code', 'write', 'design']).optional(),
  /** Initiating client surface retained so resumed children keep the same tool plane. */
  clientSurface: z.enum(['gui', 'tui', 'cli', 'api', 'im', 'extension']).optional(),
  label: z.string().optional(),
  prompt: z.string().min(1),
  /** Exact active parent turn source, when a first-class host forwards it. */
  source: ChildSourceEnvelope.optional(),
  /** Legacy read compatibility. New child runs keep host control only in private session context. */
  controlPrompt: z.string().min(1).optional(),
  workspace: z.string().optional(),
  model: z.string().optional(),
  /** Resolved provider id the child routed through, when one was selected. */
  providerId: z.string().optional(),
  /** Opaque account id inherited only with the same selected provider route. */
  accountId: z.string().optional(),
  /** Effective reasoning strength used by the child model request. */
  reasoningEffort: ModelReasoningEffort.optional(),
  /** Effective Codex service tier used by the child model request ('fast' = priority). */
  serviceTier: z.literal('priority').optional(),
  /** Resolved subagent profile name, when one was selected. */
  profile: z.string().optional(),
  /** Legacy read compatibility; new child runs never write skillId. */
  skillId: z.string().optional(),
  /** Retrieval/judge decision captured for diagnostics and reproducibility. */
  routing: ChildRoutingMetadata.optional(),
  /** Exact role definition executed by this child, including fixed/workspace profiles. */
  profileSnapshot: SubagentProfileConfig.optional(),
  profileSource: z.enum(['builtin', 'configured', 'workspace', 'custom', 'generated']).optional(),
  profileFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Immutable parent capability boundary captured before the child is queued. */
  security: ChildSecuritySnapshot.optional(),
  /** Effective tool policy applied to the child (read-only vs inherited). */
  toolPolicy: SubagentToolPolicy.optional(),
  /** Parent policy captured when the child was created. */
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalReviewer: ApprovalReviewerSchema.default(DEFAULT_APPROVAL_REVIEWER),
  /** True when this child is detached from the parent turn lifecycle. */
  detached: z.boolean().optional(),
  /** First-class caller that owns recovery policy for this child. */
  launcher: ChildRunLauncher.optional(),
  /** Budgeted source-only retrieval child; never runs a provider-native SDK loop. */
  fastContext: z.literal(true).optional(),
  /** Original grouped retrieval requests, retained for evidence and resume projection. */
  fastContextTasks: z.array(FastContextTaskSchema).min(1).max(4).optional(),
  /** Durable host-owned PPT phase identity, including attempts that fail before producing a bundle. */
  pptWorkflow: ChildPptWorkflow.optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  /** Why the latest attempt ended; cleared when another attempt starts. */
  terminationReason: ChildRunTerminationReason.optional(),
  /** Durable eligibility for the generic delegate_task resume path. */
  resumable: z.boolean().optional(),
  /** Safe structured classification for the latest failed attempt. */
  failure: ChildRunFailureSchema.optional(),
  summary: z.string().optional(),
  /** True when summary is only a bounded preview of the child result. */
  summaryTruncated: z.boolean().optional(),
  /** Full oversized Markdown result stored outside the parent model context. */
  resultRef: ChildResultRef.optional(),
  /** Safe reason the full result could not be externalized. */
  resultUnavailableReason: z.string().min(1).max(500).optional(),
  /** Structured PPT review result captured from the child tool stream. */
  reviewBundle: z.unknown().optional(),
  /** Parent turn that produced reviewBundle; distinguishes a fresh bundle from the preserved prior revision. */
  reviewBundleParentTurnId: z.string().min(1).optional(),
  /** Structured pre-review visual directions captured independently from slide review. */
  directionBundle: z.unknown().optional(),
  /** Parent turn that produced directionBundle. */
  directionBundleParentTurnId: z.string().min(1).optional(),
  /** Structured validated PPT export captured from the child tool stream. */
  deckArtifact: z.unknown().optional(),
  /** Parent turn that produced deckArtifact. */
  deckArtifactParentTurnId: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1).max(2_000)).max(32).optional(),
  /** Compact structured evidence returned to the parent instead of raw child history. */
  evidencePack: FastContextEvidencePackSchema.optional(),
  tokenBudget: z.number().int().positive().optional(),
  /** Legacy persisted field. New child runs do not use wall-clock budgets. */
  timeBudgetMs: z.number().int().positive().optional(),
  returnFormat: ChildReturnFormat.default('summary'),
  budgetExceeded: z.enum(['token', 'time']).optional(),
  error: z.string().optional(),
  usage: ChildRunUsage.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  /** True when the child reused the main agent's cached stable prefix. */
  prefixReused: z.boolean().optional(),
  /** Parent history items seeded into the child (0 = prefix-only). */
  inheritedHistoryItems: z.number().int().nonnegative().optional(),
  /** Tool calls the child executed during its run. */
  toolInvocations: z.number().int().nonnegative().optional(),
  /** Latest safe activity label mirrored from the child thread. */
  activity: ChildRunActivity.optional(),
  /** Wall-clock spent running (after leaving the queue). */
  durationMs: z.number().int().nonnegative().optional(),
  /** Wall-clock spent waiting for a parallel slot before starting. */
  queuedMs: z.number().int().nonnegative().optional(),
  /** Stable display order for this child inside its parent turn. */
  childSeq: z.number().int().nonnegative().optional(),
  /** Number of follow-up turns appended to this same persistent child session. */
  resumeCount: z.number().int().nonnegative().optional(),
  /** Number of model-initiated retries; manual user continuations do not increment it. */
  proactiveRetryCount: z.number().int().nonnegative().optional(),
  lastProactiveRetryAt: z.string().optional(),
  lastResumeAt: z.string().optional(),
  createdAt: z.string(),
  /** When the child left the queue and began running. */
  startedAt: z.string().optional(),
  updatedAt: z.string()
}).strict()
export type ChildRunRecord = z.infer<typeof ChildRunRecord>

export type ChildRunLifecycleMetadata = {
  model?: string
  providerId?: string
  accountId?: string
  reasoningEffort?: string
  profile?: string
  profileName?: string
}

export type ChildRunExecutor = (input: {
  /** Continue the persisted child thread instead of creating it again. */
  resumeChild?: boolean
  childId: string
  parentThreadId: string
  parentTurnId: string
  label?: string
  /** Resolved subagent profile id (e.g. `general`, `explore`); used for the child thread title. */
  profile?: string
  prompt: string
  /** Exact active parent turn source; never synthesized by the parent model. */
  source?: ChildSourceEnvelope
  /** Trusted host control emitted as private chronological model context. */
  controlPrompt?: string
  /** Host-minted PPT capability for this execution only. */
  pptWorkflowScope?: PptWorkflowScope
  workspace?: string
  model?: string
  providerId?: string
  accountId?: string
  clientSurface?: TurnClientSurface
  /** Product surface inherited from the active parent turn. */
  agentSurface?: 'code' | 'write' | 'design'
  systemPrompt?: string
  /** When true with a non-empty systemPrompt, skip prepending the Kun base prefix. */
  omitBasePrompt?: boolean
  allowedTools?: string[]
  /** Parent tool/provider/memory boundary; profile permissions may only narrow it. */
  security?: ChildSecuritySnapshot
  /** Built-in tool names blocked for this child (deny-list layered on inherit). */
  blockedTools?: string[]
  /** MCP server ids blocked for this child (deny-list; whole server toolset hidden). */
  blockedMcpServers?: string[]
  /** Skill ids blocked for this child (deny-list; catalog + activation + load_skill). */
  blockedSkills?: string[]
  /** Disable skill discovery and load_skill for standalone profile agents. */
  skillsEnabled?: boolean
  toolPolicy: SubagentToolPolicy
  /** Parent security snapshot; it takes precedence over executor defaults. */
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  promptPreamble?: string
  /** True when the parent turn is a GUI design-canvas turn. */
  guiDesignCanvas?: boolean
  /** Reasoning depth for this profile's child model requests (default 'off'). */
  reasoningEffort?: string
  /** Effective Codex service tier for this child's model requests ('fast' = priority). */
  serviceTier?: 'priority'
  returnFormat?: ChildReturnFormat
  /** Strict budgeted retrieval mode used only by fast_context. */
  fastContext?: boolean
  /** Original task grouping used to build the structured evidence pack. */
  fastContextTasks?: readonly FastContextTask[]
  signal: AbortSignal
}) => Promise<{
  summary: string
  summaryTruncated?: boolean
  resultRef?: ChildResultRef
  resultUnavailableReason?: string
  usage?: ChildRunRecord['usage']
  toolInvocations?: number
  prefixReused?: boolean
  inheritedHistoryItems?: number
  reviewBundle?: unknown
  directionBundle?: unknown
  deckArtifact?: unknown
  evidence?: string[]
  evidencePack?: FastContextEvidencePack
}>

export type ChildRunAggregate = {
  key: string
  label?: string
  model?: string
  runs: number
  completed: number
  failed: number
  aborted: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  costCny?: number
  averageTotalTokens: number
  averageCostUsd?: number
  averageCostCny?: number
}

export class FileDelegationStore {
  constructor(private readonly rootDir: string) {}

  async upsert(record: ChildRunRecord): Promise<void> {
    await this.ensureRoot()
    const path = join(this.rootDir, `${record.id}.json`)
    await withManagerDataMutex(`delegation-run:${record.id}`, () =>
      isManagerAtomicJsonPath(path)
        ? new AtomicJsonFile(
            path,
            (value) => ChildRunRecord.parse(value)
          ).write(record)
        : writeFile(path, JSON.stringify(record, null, 2), {
            encoding: 'utf8',
            mode: 0o600
          }))
  }

  async get(childId: string): Promise<ChildRunRecord | undefined> {
    await this.ensureRoot()
    try {
      return ChildRunRecord.parse(JSON.parse(await readFile(join(this.rootDir, `${childId}.json`), 'utf8')))
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async delete(childId: string): Promise<void> {
    await this.ensureRoot()
    await withManagerDataMutex(`delegation-run:${childId}`, async () => {
      await rm(join(this.rootDir, `${childId}.json`), { force: true })
    })
  }

  async list(parentThreadId?: string): Promise<ChildRunRecord[]> {
    await this.ensureRoot()
    const entries = await readdir(this.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.rootDir, entry), 'utf8')
        .then((text) => ChildRunRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records
      .filter((record): record is ChildRunRecord => Boolean(record))
      .filter((record) => !parentThreadId || record.parentThreadId === parentThreadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    await applyPosixMode(this.rootDir, 0o700)
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
}
