import { createHash } from 'node:crypto'
import {
  GRAPH_CONTRACT_VERSION,
  GraphAssignmentSnapshotV1Schema,
  type GraphAgentProfileVersionV1,
  type GraphAssignmentReferenceV1,
  type GraphAssignmentSnapshotV1,
  type GraphNodeV1
} from '../contracts/index.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import type { ProjectAgentRegistry } from './project-agent-registry.js'
import {
  GRAPH_LEAD_TOOL_NAMES,
  GRAPH_INCOMPATIBLE_TOOL_NAMES,
  GRAPH_WORKER_REPORT_TOOL_NAME,
  GRAPH_WORKER_TOOL_NAMES
} from './graph-tool-boundary.js'
import { graphHostRelativePathCovers } from './graph-platform-path.js'
import { withGlobalSubagentTools } from '../delegation/subagent-global-tool-policy.js'

export type GraphParentAuthority = {
  workspaceRoot: string
  model: string
  providerId: string
  accountId?: string
  allowedModelProviderIds?: readonly string[]
  allowedModels?: readonly string[]
  allowedProviderIds?: readonly string[]
  reasoningEffort: ModelReasoningEffort
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer?: ApprovalReviewer
  allowedTools: readonly string[]
  blockedTools: readonly string[]
  allowedSkills: readonly string[]
  blockedSkills: readonly string[]
  allowedMcpServers: readonly string[]
  blockedMcpServers: readonly string[]
  readScopes: readonly string[]
  writeScopes: readonly string[]
  networkAllowed: boolean
}

export type GraphAssignmentResolverOptions = {
  registry: ProjectAgentRegistry
  nowIso?: () => string
}

export class GraphAssignmentResolver {
  private readonly nowIso: () => string

  constructor(private readonly options: GraphAssignmentResolverOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async resolve(input: {
    projectId: string
    node: GraphNodeV1
    reference: GraphAssignmentReferenceV1
    parent: GraphParentAuthority
    maxWallTimeMs: number
  }): Promise<GraphAssignmentSnapshotV1> {
    const capturedAt = this.nowIso()
    const requested = input.reference.kind === 'existing' ? input.reference : undefined
    const existing = requested
      ? await this.resolveExisting(input.projectId, requested.profileId, requested.profileVersion)
      : undefined
    const missingRequestedProfile = requested && !existing
    const profile = existing ?? (missingRequestedProfile
      ? ephemeralProfile(
          missingProfileFallback(input.node, requested),
          input.parent,
          capturedAt
        )
      : ephemeralProfile(
          input.reference as Extract<GraphAssignmentReferenceV1, { kind: 'ephemeral' }>,
          input.parent,
          capturedAt
        ))
    const caps = profile.capabilities
    if (!['probation', 'trusted'].includes(profile.lifecycle) && profile.origin !== 'ephemeral') {
      throw new Error(`profile ${profile.profileId} lifecycle ${profile.lifecycle} is not executable`)
    }
    assertScopeSubset(input.node.readScopes, input.parent.readScopes, 'node read')
    assertScopeSubset(input.node.writeScopes, input.parent.writeScopes, 'node write')
    assertScopeSubset(input.node.readScopes, caps.readScopes.length ? caps.readScopes : input.parent.readScopes, 'profile read')
    assertScopeSubset(input.node.writeScopes, caps.writeScopes.length ? caps.writeScopes : input.parent.writeScopes, 'profile write')
    const sandboxMode = narrowerSandbox(input.parent.sandboxMode, caps.sandboxMode)
    if (input.node.writeScopes.length && sandboxMode === 'read-only') {
      throw new Error(`profile ${profile.profileId} cannot satisfy node write scope`)
    }
    const toolPolicy = caps.toolPolicy === 'readOnly' ? 'readOnly' : 'inherit'
    const graphControlTools = new Set<string>([
      ...GRAPH_LEAD_TOOL_NAMES,
      ...GRAPH_WORKER_TOOL_NAMES,
      GRAPH_WORKER_REPORT_TOOL_NAME
    ])
    const blockedTools = union(input.parent.blockedTools, caps.blockedTools, [
      ...GRAPH_INCOMPATIBLE_TOOL_NAMES,
      ...GRAPH_LEAD_TOOL_NAMES,
      ...GRAPH_WORKER_TOOL_NAMES,
      'graph_agent_governance'
    ]).filter((tool) => tool !== GRAPH_WORKER_REPORT_TOOL_NAME)
    const ordinaryAllowedTools = union(
      intersect(input.parent.allowedTools, caps.allowedTools)
        .filter((tool) => !graphControlTools.has(tool)),
      [GRAPH_WORKER_REPORT_TOOL_NAME]
    )
    const allowedTools = withGlobalSubagentTools({
      allowedToolNames: ordinaryAllowedTools,
      parentAllowedToolNames: input.parent.allowedTools,
      blockedToolNames: blockedTools,
      parentAllowedProviderIds: input.parent.allowedProviderIds
    }) ?? ordinaryAllowedTools
    const allowedSkills = intersect(input.parent.allowedSkills, caps.allowedSkills)
    const allowedMcpServers = intersect(input.parent.allowedMcpServers, caps.allowedMcpServers)
    const blockedSkills = union(input.parent.blockedSkills, caps.blockedSkills)
    const blockedMcpServers = union(
      input.parent.blockedMcpServers,
      caps.blockedMcpServers,
      input.parent.allowedMcpServers.filter((serverId) => !allowedMcpServers.includes(serverId))
    )
    const approvalPolicy = narrowerApproval(input.parent.approvalPolicy, caps.approvalPolicy)
    const model = profile.model || input.parent.model
    const providerId = profile.providerId || input.parent.providerId
    const accountId =
      model === input.parent.model && providerId === input.parent.providerId
        ? input.parent.accountId
        : undefined
    const allowedModelProviderIds = input.parent.allowedModelProviderIds ?? [input.parent.providerId]
    const allowedModels = input.parent.allowedModels ?? [input.parent.model]
    const allowedProviderIds = input.parent.allowedProviderIds ?? []
    if (!allowedModelProviderIds.includes(providerId)) {
      throw new Error(`profile ${profile.profileId} model provider ${providerId} expands parent authority`)
    }
    if (!allowedModels.includes(model)) {
      throw new Error(`profile ${profile.profileId} model ${model} expands parent authority`)
    }
    return GraphAssignmentSnapshotV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      profileOrigin: profile.origin,
      ...(requested ? {
        requestedProfileId: requested.profileId,
        ...(requested.profileVersion
          ? { requestedProfileVersion: requested.profileVersion }
          : {})
      } : {}),
      ...(missingRequestedProfile ? {
        routingReason:
          `Requested project profile "${requested.profileId}" was unavailable; ` +
          'Kun created a graph-scoped least-authority fallback.'
      } : {}),
      name: profile.name,
      systemPrompt: profile.systemPrompt,
      model,
      providerId,
      ...(accountId ? { accountId } : {}),
      allowedModelProviderIds,
      allowedModels,
      allowedProviderIds,
      reasoningEffort: profile.reasoningEffort ?? input.parent.reasoningEffort,
      toolPolicy,
      allowedTools,
      blockedTools,
      allowedSkills,
      blockedSkills,
      allowedMcpServers,
      blockedMcpServers,
      approvalPolicy,
      sandboxMode,
      // Profiles may narrow tool/sandbox policy, but reviewer routing is an
      // immutable parent boundary and is never profile-controlled.
      approvalReviewer: input.parent.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
      workspaceRoot: input.parent.workspaceRoot,
      readScopes: input.node.readScopes,
      writeScopes: input.node.writeScopes,
      networkAllowed: input.parent.networkAllowed && caps.networkAllowed,
      maxWallTimeMs: input.maxWallTimeMs,
      capturedAt
    })
  }

  private async resolveExisting(
    projectId: string,
    profileId: string,
    version?: number
  ): Promise<GraphAgentProfileVersionV1 | null> {
    return this.options.registry.getProfile(projectId, profileId, version)
  }
}

function missingProfileFallback(
  node: GraphNodeV1,
  requested: Extract<GraphAssignmentReferenceV1, { kind: 'existing' }>
): Extract<GraphAssignmentReferenceV1, { kind: 'ephemeral' }> {
  const criteria = node.completion.acceptanceCriteria
    .map((item) => `- ${item}`)
    .join('\n')
  return {
    kind: 'ephemeral',
    name: `${node.title} fallback`.slice(0, 128),
    description:
      `Graph-scoped replacement for unavailable project profile ${requested.profileId}.`
        .slice(0, 1_024),
    systemPrompt: [
      'You are a task executor created because the requested project profile is unavailable.',
      'Complete only the assigned task. Do not delegate, coordinate other agents, or manage any workflow.',
      `Task objective:\n${node.objective}`,
      `Acceptance criteria:\n${criteria}`,
      'Finish with a concise normal response describing the result, changed files, checks, evidence, and risks.'
    ].join('\n\n'),
    toolPolicy: node.writeScopes.length ? 'inherit' : 'readOnly',
    blockedTools: [],
    blockedSkills: [],
    blockedMcpServers: []
  }
}

function ephemeralProfile(
  reference: Extract<GraphAssignmentReferenceV1, { kind: 'ephemeral' }>,
  parent: GraphParentAuthority,
  createdAt: string
): GraphAgentProfileVersionV1 {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(reference))
    .digest('hex')
    .slice(0, 24)
  return {
    version: GRAPH_CONTRACT_VERSION,
    profileId: `ephemeral_${fingerprint}`,
    profileVersion: 1,
    origin: 'ephemeral',
    lifecycle: 'trusted',
    name: reference.name,
    description: reference.description ?? 'Bounded ephemeral task executor',
    systemPrompt: reference.systemPrompt,
    model: reference.model ?? parent.model,
    providerId: reference.providerId ?? parent.providerId,
    reasoningEffort: reference.reasoningEffort ?? parent.reasoningEffort,
    capabilities: {
      taskTypes: [],
      capabilityTags: [],
      toolPolicy: reference.toolPolicy,
      allowedTools: reference.allowedTools ?? [...parent.allowedTools],
      blockedTools: reference.blockedTools,
      allowedSkills: reference.allowedSkills ?? [...parent.allowedSkills],
      blockedSkills: reference.blockedSkills,
      allowedMcpServers: reference.allowedMcpServers ?? [...parent.allowedMcpServers],
      blockedMcpServers: reference.blockedMcpServers,
      approvalPolicy: parent.approvalPolicy,
      sandboxMode: parent.sandboxMode,
      readScopes: [...parent.readScopes],
      writeScopes: [...parent.writeScopes],
      networkAllowed: parent.networkAllowed,
      maximumRiskClass: 'critical'
    },
    provenanceEpisodeIds: [],
    createdAt,
    createdBy: 'system'
  }
}

function assertScopeSubset(
  requested: readonly string[],
  allowed: readonly string[],
  label: string
): void {
  for (const scope of requested) {
    if (!allowed.some((parent) => graphHostRelativePathCovers(parent, scope))) {
      throw new Error(`${label} scope ${scope} expands parent authority`)
    }
  }
}

function intersect(parent: readonly string[], requested: readonly string[]): string[] {
  if (requested.length === 0) return []
  const parentSet = new Set(parent)
  return [...new Set(requested)].filter((item) => parentSet.has(item)).sort()
}

function union(...values: readonly (readonly string[])[]): string[] {
  return [...new Set(values.flatMap((value) => [...value]))].sort()
}

function narrowerSandbox(parent: SandboxMode, requested: SandboxMode): SandboxMode {
  const rank: Record<SandboxMode, number> = {
    'read-only': 0,
    'external-sandbox': 1,
    'workspace-write': 2,
    'danger-full-access': 3
  }
  return rank[requested] <= rank[parent] ? requested : parent
}

function narrowerApproval(
  parent: ApprovalPolicy,
  requested: ApprovalPolicy
): ApprovalPolicy {
  const rank: Record<ApprovalPolicy, number> = {
    never: 0,
    always: 1,
    untrusted: 2,
    'on-request': 3,
    suggest: 3,
    auto: 4
  }
  return rank[requested] <= rank[parent] ? requested : parent
}
