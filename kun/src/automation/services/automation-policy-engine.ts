import type {
  DigitalEmployee,
  AutomationTask,
  RiskAssessment,
  AutomationRiskLevel
} from '../contracts/automation-types.js'
import { riskAtOrAbove, DEFAULT_SENSITIVE_KEYWORDS } from '../contracts/automation-types.js'

/**
 * Automation Policy Engine
 *
 * Evaluates risk and determines whether a task should be:
 * - 'draft' (save without action)
 * - 'request_approval' (human approval required)
 * - 'send' (auto-execute)
 * - 'block' (policy violation)
 */

export type PolicyDecisionInput = {
  employee: DigitalEmployee
  task: AutomationTask
  proposedOutput: string
  sourceMetadata?: Record<string, unknown>
  recentTasks?: AutomationTask[]
  now?: Date
  approvalGranted?: boolean
}

export type PolicyDecision =
  | { kind: 'draft'; risk: RiskAssessment }
  | { kind: 'request_approval'; risk: RiskAssessment }
  | { kind: 'send'; risk: RiskAssessment }
  | { kind: 'block'; risk: RiskAssessment; message: string }

export class AutomationPolicyEngine {
  evaluate(input: PolicyDecisionInput): PolicyDecision {
    const risk = this.assessRisk(input)
    const policy = input.employee.autoReplyPolicy

    // Block critical risks
    if (risk.level === 'critical' && risk.matchedRules.some((r) => r.startsWith('block.'))) {
      return {
        kind: 'block',
        risk: { ...risk, policyDecision: 'block', requiresApproval: false },
        message: risk.reasons[0] || 'Automation policy blocked this task.'
      }
    }

    // Draft if policy disabled or external send not allowed
    if (
      !policy.enabled ||
      input.task.actionLevel !== 'external_send' ||
      !policy.allowExternalSend
    ) {
      return {
        kind: 'draft',
        risk: { ...risk, policyDecision: 'draft', requiresApproval: false }
      }
    }

    // Manual approval mode
    if (input.employee.approvalPolicy.mode === 'manual' && !input.approvalGranted) {
      return {
        kind: 'request_approval',
        risk: { ...risk, policyDecision: 'request_approval', requiresApproval: true }
      }
    }

    // Risk-based approval threshold
    const threshold = mostConservativeThreshold(
      policy.requireApprovalRiskAtOrAbove,
      input.employee.approvalPolicy.requireApprovalRiskAtOrAbove
    )

    if (riskAtOrAbove(risk.level, threshold) && !input.approvalGranted) {
      return {
        kind: 'request_approval',
        risk: { ...risk, policyDecision: 'request_approval', requiresApproval: true }
      }
    }

    // Rate limit check
    const recentCount = this.countRecentTasks(input.recentTasks || [], input.now)
    if (recentCount >= policy.maxRepliesPerHour) {
      return {
        kind: 'request_approval',
        risk: {
          ...risk,
          level: 'high',
          reasons: [...risk.reasons, `Rate limit: ${recentCount}/${policy.maxRepliesPerHour} replies this hour`],
          matchedRules: [...risk.matchedRules, 'rate_limit.hour'],
          policyDecision: 'request_approval',
          requiresApproval: true
        }
      }
    }

    // Auto-send if all checks pass
    return {
      kind: 'send',
      risk: { ...risk, policyDecision: 'send', requiresApproval: false }
    }
  }

  private assessRisk(input: PolicyDecisionInput): RiskAssessment {
    const reasons: string[] = []
    const matchedRules: string[] = []
    let level: AutomationRiskLevel = 'low'

    const output = input.proposedOutput.toLowerCase()
    const policy = input.employee.autoReplyPolicy

    // Sensitive keywords check
    const sensitiveKeywords = [
      ...DEFAULT_SENSITIVE_KEYWORDS,
      ...policy.requireApprovalKeywords
    ]
    const foundKeywords = sensitiveKeywords.filter((kw) => output.includes(kw.toLowerCase()))
    if (foundKeywords.length > 0) {
      level = 'high'
      reasons.push(`Contains sensitive keywords: ${foundKeywords.join(', ')}`)
      matchedRules.push('sensitive_keywords')
    }

    // Deny list check
    const foundDenyList = policy.denyList.filter((pattern) =>
      output.includes(pattern.toLowerCase())
    )
    if (foundDenyList.length > 0) {
      level = 'critical'
      reasons.push(`Matches deny list: ${foundDenyList.join(', ')}`)
      matchedRules.push('block.deny_list')
    }

    // URL/link check
    if (/https?:\/\//.test(output)) {
      if (level === 'low') level = 'medium'
      reasons.push('Contains external links')
      matchedRules.push('contains_links')
    }

    // Financial amounts
    if (/\$\d+|\d+\s?(USD|EUR|GBP|CNY|元)/.test(output)) {
      if (level === 'low' || level === 'medium') level = 'high'
      reasons.push('Contains financial amounts')
      matchedRules.push('financial_amounts')
    }

    // Long output (>1000 chars)
    if (input.proposedOutput.length > 1000) {
      if (level === 'low') level = 'medium'
      reasons.push('Long output (>1000 chars)')
      matchedRules.push('long_output')
    }

    // Attachment mention
    if (/attach(ment|ed)|file|document|pdf/i.test(output)) {
      if (level === 'low') level = 'medium'
      reasons.push('References attachments')
      matchedRules.push('attachment_reference')
    }

    return {
      level,
      reasons,
      matchedRules,
      requiresApproval: level !== 'low',
      policyDecision: 'pending'
    }
  }

  private countRecentTasks(
    recentTasks: AutomationTask[],
    now: Date = new Date()
  ): number {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    return recentTasks.filter((t) =>
      t.status === 'completed' &&
      t.completedAt &&
      t.completedAt >= oneHourAgo
    ).length
  }
}

function mostConservativeThreshold(
  a: AutomationRiskLevel,
  b: AutomationRiskLevel
): AutomationRiskLevel {
  return riskAtOrAbove(a, b) ? b : a
}
