import type { ToolHostContext } from '../../ports/tool-host.js'
import { normalizeInheritedReasoningEffort } from '../../delegation/delegation-runtime-support.js'
import type { ChildRunRecord } from '../../delegation/delegation-runtime-contracts.js'

export function childSecurity(context: ToolHostContext) {
  return {
    sandboxRoot: context.workspace,
    ...(context.allowedModelProviderIds ? { allowedModelProviderIds: [...context.allowedModelProviderIds] } : {}),
    ...(context.allowedModelIds ? { allowedModelIds: [...context.allowedModelIds] } : {}),
    ...(context.allowedProviderIds ? { allowedProviderIds: [...context.allowedProviderIds] } : {}),
    ...(context.allowedToolNames ? { allowedToolNames: [...context.allowedToolNames] } : {}),
    ...(context.allowedSkillIds ? { allowedSkillIds: [...context.allowedSkillIds] } : {}),
    ...(context.allowedReadPaths ? { allowedReadPaths: [...context.allowedReadPaths] } : {}),
    ...(context.allowedWritePaths ? { allowedWritePaths: [...context.allowedWritePaths] } : {}),
    ...(context.allowedArtifactIds ? { allowedArtifactIds: [...context.allowedArtifactIds] } : {}),
    ...(context.blockedProviderIds ? { blockedProviderIds: [...context.blockedProviderIds] } : {}),
    ...(context.blockedToolNames ? { blockedToolNames: [...context.blockedToolNames] } : {}),
    ...(context.blockedSkillIds ? { blockedSkillIds: [...context.blockedSkillIds] } : {}),
    memoryEnabled: context.memoryPolicy?.enabled === true
  }
}


export function parentModelRoute(context: ToolHostContext): ChildRunRecord['parentModelRoute'] {
  const model = context.actingModelRoute?.model ?? context.model?.id?.trim()
  const providerId = context.actingModelRoute?.providerId ?? context.modelProviderId?.trim()
  if (!model || !providerId) return undefined
  return {
    model, providerId,
    accountId: context.actingModelRoute?.accountId,
    reasoningEffort: normalizeInheritedReasoningEffort(context.reasoningEffort),
    serviceTier: context.serviceTier
  }
}
