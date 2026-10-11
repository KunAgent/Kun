import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertAgentModel } from '../agents/agent-models.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { WorkbenchExecution, WorkbenchLink, WorkbenchRequest } from '../contracts/workbench-links.js'
import type { WorkbenchBridge } from './bridge.js'
import { parseGatewayModelId } from '../harness/gateway-model-id.js'
import { buildPlanBuildPrompt } from '../shared/plan-build-prompt.js'

export function executionMode(request: WorkbenchRequest): WorkbenchExecution['mode'] {
  return request.execution?.mode ?? (request.mode === 'plan' ? 'plan' : 'direct')
}

export function planRelativePath(link: WorkbenchLink): string {
  const slug = link.request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'
  return `.kunsdd/plan/${slug}-${link.id.slice(-8).replace(/[^a-z0-9]/gi, '')}.md`
}

export async function validateExecution(bridge: WorkbenchBridge, roomId: string, request: WorkbenchRequest,
  code = false): Promise<WorkbenchRequest> {
  if (bridge.harnesses && code) {
    const model = await bridge.harnesses.resolve(request)
    request = { ...request, execution: { ...request.execution, mode: executionMode(request), model } }
  } else if (request.execution?.model?.harnessId && request.execution.model.harnessId !== 'kun') {
    throw new Error('Code Agent routing is unavailable in this runtime')
  }
  const execution = request.execution
  if (execution?.model) {
    if (!bridge.harnesses || !code) await assertAgentModel(bridge.deps, execution.model)
    const snapshot = await bridge.deps.modelSnapshot?.()
    const provider = snapshot?.providers.find((item) => item.id === execution.model?.providerId)
    const effort = execution.model.reasoningEffort
    const modelId = parseGatewayModelId(execution.model.model)?.model ?? execution.model.model
    const supported = provider?.modelCapabilities?.[modelId]?.reasoning?.supportedEfforts
    if (effort && effort !== 'auto' && supported && !supported.includes(effort)) {
      throw new Error('The selected reasoning effort is unavailable for this model')
    }
    const tiers = provider?.modelCapabilities?.[modelId]?.serviceTiers
    if (execution.model.serviceTier && tiers && !tiers.includes(execution.model.serviceTier)) {
      throw new Error('Fast mode is unavailable for this model')
    }
  }
  if (execution?.permission && await bridge.permissionCeiling(roomId, kunToolPermissionModeSettings(execution.permission))) {
    throw new Error('The selected permission exceeds this Agent’s limit')
  }
  if (execution?.mode === 'goal' && !request.goal.trim()) throw new Error('A goal is required for goal mode')
  if (execution?.goalTokenBudget && execution.mode !== 'goal') throw new Error('Token budgets require goal mode')
  return request
}

/** The saved plan is embedded so execution still works when a worktree omits it. */
export async function buildTaskPlanPrompt(workspace: string, relativePath: string,
  orchestration: 'direct' | 'graph' = 'direct'): Promise<string> {
  const markdown = await readFile(join(workspace, relativePath), 'utf8')
  if (!markdown.trim()) throw new Error('The plan is empty')
  return buildPlanBuildPrompt(relativePath, markdown, orchestration)
}
