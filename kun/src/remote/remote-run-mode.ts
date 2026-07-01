/**
 * Task-level run modes for a remote target (Issue #647).
 *
 * A remote thread picks a run mode that auto-scopes what the agent may do, so
 * "remote" never means "full shell on the server". The mode + the command risk
 * classification together yield an allow / confirm / deny decision. Production
 * targets escalate: irreversible operations are never silent even with full
 * permissions.
 */

import {
  classifyRemoteCommand,
  isIrreversibleCategory,
  type RemoteCommandCategory,
  type RemoteCommandClassification,
  type RemoteRiskLevel
} from './remote-command-risk.js'

export type RemoteRunMode = 'observe' | 'develop' | 'operations' | 'deploy'

export type RemoteGuardDecision = 'allow' | 'confirm' | 'deny'

export type RemoteCommandEvaluation = {
  decision: RemoteGuardDecision
  mode: RemoteRunMode
  category: RemoteCommandCategory
  level: RemoteRiskLevel
  writes: boolean
  reasons: string[]
}

/** Categories each mode permits WITHOUT a deny. Confirmation is layered on top. */
const MODE_ALLOWED: Record<RemoteRunMode, ReadonlySet<RemoteCommandCategory>> = {
  // Observe: strictly read-only investigation.
  observe: new Set(['read-only']),
  // Develop: project work + tests + dependency installs, but not service/infra.
  develop: new Set(['read-only', 'test-run', 'project-write', 'dependency-install', 'network-write', 'standard']),
  // Operations: process/container/service management on top of develop.
  operations: new Set([
    'read-only', 'test-run', 'project-write', 'dependency-install', 'network-write', 'standard',
    'service-control', 'container-destructive', 'k8s-mutation'
  ]),
  // Deploy: everything operations can do; deploy-class actions still confirm.
  deploy: new Set([
    'read-only', 'test-run', 'project-write', 'dependency-install', 'network-write', 'standard',
    'service-control', 'container-destructive', 'k8s-mutation', 'db-migration', 'network-security'
  ])
}

export function evaluateRemoteCommand(input: {
  command: string
  mode: RemoteRunMode
  /** True when the target is a production host — escalates confirmation. */
  production?: boolean
  classification?: RemoteCommandClassification
}): RemoteCommandEvaluation {
  const classification = input.classification ?? classifyRemoteCommand(input.command)
  const reasons: string[] = [classification.reason]
  const allowed = MODE_ALLOWED[input.mode]

  let decision: RemoteGuardDecision
  if (!allowed.has(classification.category)) {
    decision = 'deny'
    reasons.push(`'${classification.category}' is not permitted in '${input.mode}' mode`)
  } else if (isIrreversibleCategory(classification.category)) {
    // Permitted but irreversible → always confirm, never silent.
    decision = 'confirm'
    reasons.push('irreversible / high-blast-radius operation requires confirmation')
  } else if (classification.level === 'high' || classification.level === 'critical') {
    decision = 'confirm'
    reasons.push(`risk level '${classification.level}' requires confirmation`)
  } else {
    decision = 'allow'
  }

  // Production escalation: anything that writes must be confirmed, and a deny
  // stays a deny. Secrets/privilege escalation are never auto-allowed.
  if (input.production && decision === 'allow' && classification.writes) {
    decision = 'confirm'
    reasons.push('production target: state-changing commands require confirmation')
  }

  return {
    decision,
    mode: input.mode,
    category: classification.category,
    level: classification.level,
    writes: classification.writes,
    reasons
  }
}
