/**
 * Plan-phase harness admission for `graph_define_plan` (docs/ade/impl
 * p1-manager §P1-25): every intent task that names a `harnessId` is checked
 * through the same `checkHarnessAdmission` the HarnessRouter uses at turn
 * time, with the workspace isolation Graph would actually grant the node —
 * read-only nodes are always isolated; write nodes are isolated only when
 * write isolation is `worktree`.
 */
import type { GraphPlanV1, GraphPlanningIssueV1 } from '../../contracts/graph.js'
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute,
  HarnessStatus
} from '../../contracts/harness.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import type { GraphRuntimeConfig } from '../../config/kun-config.js'
import { checkHarnessAdmission } from '../../harness/harness-admission.js'
import { defaultCredentialMode } from '../../harness/resolve-turn-harness.js'
import { MINIMAL_VALID_PLAN_EXAMPLE } from './graph-define-plan-support.js'

export type GraphPlanHarnessAdmission = {
  catalog: {
    get(id: string): HarnessDefinition | undefined
    isDisabled?(id: HarnessId): boolean
  }
  detector: { status(id: HarnessId): Promise<HarnessStatus> }
  capabilitiesForRoute(route: HarnessRoute): Promise<HarnessCapabilities>
  allowUnattendedFullAccess?(): boolean
}

export async function checkGraphPlanHarnesses(input: {
  plan: GraphPlanV1
  admission: GraphPlanHarnessAdmission
  isolation: GraphRuntimeConfig['writeIsolation']
}): Promise<GraphPlanningIssueV1[]> {
  const issues: GraphPlanningIssueV1[] = []
  for (const [index, node] of input.plan.nodes.entries()) {
    const reference = node.assignment
    if (reference?.kind !== 'ephemeral' || !reference.harnessId) continue
    const taskPath = ['plan', 'tasks', index, 'harnessId']
    const definition = input.admission.catalog.get(reference.harnessId)
    if (!definition) {
      issues.push(issue(taskPath, 'harness_unknown',
        `task ${node.id} names unknown harness '${reference.harnessId}'.`))
      continue
    }
    if (input.admission.catalog.isDisabled?.(definition.id)) {
      issues.push(issue(taskPath, 'harness_unavailable',
        `task ${node.id}: harness '${definition.id}' is disabled in settings.`))
      continue
    }
    const credentialMode =
      reference.credentialMode ?? defaultCredentialMode(definition.id, definition)
    if (!definition.credentialModes.includes(credentialMode)) {
      issues.push(issue(
        ['plan', 'tasks', index, 'credentialMode'],
        'credential_unsupported',
        `task ${node.id}: harness '${definition.id}' does not support ` +
          `credentialMode '${credentialMode}' ` +
          `(supported: ${definition.credentialModes.join(', ')}).`
      ))
      continue
    }
    const route: HarnessRoute = {
      harnessId: definition.id,
      model: 'graph-worker',
      credentialMode
    }
    const status = await input.admission.detector
      .status(definition.id)
      .catch(() => undefined)
    const effective = await input.admission
      .capabilitiesForRoute(route)
      .catch(() => undefined)
    if (!effective) {
      issues.push(issue(taskPath, 'harness_unavailable',
        `task ${node.id}: capabilities for harness '${definition.id}' could not be resolved.`))
      continue
    }
    const verdict = checkHarnessAdmission({
      usage: 'graph-worker',
      harness: definition,
      effective,
      status: status ?? {
        harnessId: definition.id,
        installed: 'yes',
        login: 'unknown',
        checkedAt: '1970-01-01T00:00:00.000Z'
      },
      workspace: {
        isolated: node.writeScopes.length > 0
          ? input.isolation.mode === 'worktree' && input.isolation.allowWorktrees
          : true
      },
      unattended: true,
      allowUnattendedFullAccess: input.admission.allowUnattendedFullAccess?.() ?? false
    })
    if (!verdict.ok) {
      issues.push(issue(taskPath, verdict.code,
        `task ${node.id}: harness '${definition.id}' fails admission — ${verdict.message}`))
    }
  }
  return issues
}

function issue(
  path: readonly (string | number)[],
  code: string,
  message: string
): GraphPlanningIssueV1 {
  return {
    code,
    path: [...path],
    message: message.slice(0, 2_048),
    repairHint:
      'Pick a harnessId from the ready harnesses listed in the planning context, ' +
      'or omit it for the default route.',
    validExample: MINIMAL_VALID_PLAN_EXAMPLE
  }
}
