import { z } from 'zod'

/**
 * Automation Domain Contracts
 *
 * Defines digital employee configuration, task lifecycle, risk assessment,
 * and scheduling schemas. Ported from workStone with Zod-based validation
 * and clean separation from the shared/app-settings monolith.
 */

// ─── Enums & Constants ───

export const DIGITAL_EMPLOYEE_TYPES = ['mail', 'social'] as const
export type DigitalEmployeeType = (typeof DIGITAL_EMPLOYEE_TYPES)[number]

export const DIGITAL_EMPLOYEE_STATUSES = [
  'draft', 'active', 'paused', 'running', 'waiting_approval', 'failed', 'disabled'
] as const
export type DigitalEmployeeStatus = (typeof DIGITAL_EMPLOYEE_STATUSES)[number]

export const AUTOMATION_ACTION_LEVELS = ['suggestion', 'draft', 'execute', 'external_send'] as const
export type AutomationActionLevel = (typeof AUTOMATION_ACTION_LEVELS)[number]

export const AUTOMATION_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type AutomationRiskLevel = (typeof AUTOMATION_RISK_LEVELS)[number]

export const AUTOMATION_RISK_ORDER: Record<AutomationRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
}

export function riskAtOrAbove(level: AutomationRiskLevel, threshold: AutomationRiskLevel): boolean {
  return AUTOMATION_RISK_ORDER[level] >= AUTOMATION_RISK_ORDER[threshold]
}

export const AUTOMATION_TASK_SOURCES = [
  'manual', 'schedule', 'mail_trigger', 'social_trigger', 'api'
] as const
export type AutomationTaskSource = (typeof AUTOMATION_TASK_SOURCES)[number]

export const AUTOMATION_TASK_STATUSES = [
  'pending', 'running', 'waiting_approval', 'approved', 'rejected',
  'completed', 'failed', 'cancelled'
] as const
export type AutomationTaskStatus = (typeof AUTOMATION_TASK_STATUSES)[number]

export const APPROVAL_POLICY_MODES = ['manual', 'risk_based', 'auto', 'auto_low_risk'] as const
export type ApprovalPolicyMode = (typeof APPROVAL_POLICY_MODES)[number]

// ─── Sub-schemas ───

export const ApprovalPolicySchema = z.object({
  mode: z.enum(APPROVAL_POLICY_MODES).default('risk_based'),
  requireApprovalRiskAtOrAbove: z.enum(AUTOMATION_RISK_LEVELS).default('medium'),
  timeoutMinutes: z.number().int().positive().default(1440),
  allowApproverEdit: z.boolean().default(true)
})
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export const AutoReplyPolicySchema = z.object({
  enabled: z.boolean().default(false),
  actionLevel: z.enum(AUTOMATION_ACTION_LEVELS).default('draft'),
  allowExternalSend: z.boolean().default(false),
  maxRepliesPerHour: z.number().int().positive().default(12),
  maxRepliesPerThreadPerDay: z.number().int().positive().default(3),
  quietHours: z.object({
    enabled: z.boolean().default(false),
    start: z.string().default('22:00'),
    end: z.string().default('08:00')
  }).default({ enabled: false, start: '22:00', end: '08:00' }),
  allowList: z.array(z.string()).default([]),
  denyList: z.array(z.string()).default([]),
  requireApprovalRiskAtOrAbove: z.enum(AUTOMATION_RISK_LEVELS).default('medium'),
  requireApprovalKeywords: z.array(z.string()).default([])
})
export type AutoReplyPolicy = z.infer<typeof AutoReplyPolicySchema>

export const DigitalEmployeeProfileSchema = z.object({
  roleDescription: z.string().default(''),
  workBoundary: z.string().default(''),
  tone: z.string().default('professional'),
  defaultDeliverableFormat: z.string().default('concise answer')
})
export type DigitalEmployeeProfile = z.infer<typeof DigitalEmployeeProfileSchema>

export const KnowledgeScopeSchema = z.object({
  knowledgeBaseIds: z.array(z.string()).default([]),
  minScore: z.number().min(0).max(1).default(0.4),
  citeSources: z.boolean().default(true),
  conflictPolicy: z.enum(['draft_approval', 'prefer_newer', 'prefer_manual']).default('draft_approval')
})
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>

export const ExpertEscalationRuleSchema = z.object({
  id: z.string().min(1),
  match: z.string(),
  expertId: z.string().optional(),
  expertTeamId: z.string().optional(),
  collaborationMode: z.enum(['lead_only', 'plan_confirm', 'auto']).optional()
})
export type ExpertEscalationRule = z.infer<typeof ExpertEscalationRuleSchema>

export const ExpertAssignmentSchema = z.object({
  expertId: z.string().default(''),
  expertTeamId: z.string().default(''),
  collaborationMode: z.enum(['lead_only', 'plan_confirm', 'auto']).default('lead_only'),
  escalationRules: z.array(ExpertEscalationRuleSchema).default([])
}).default({ expertId: '', expertTeamId: '', collaborationMode: 'lead_only', escalationRules: [] })
export type ExpertAssignment = z.infer<typeof ExpertAssignmentSchema>

// ─── Digital Employee ───

export const DigitalEmployeeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(DIGITAL_EMPLOYEE_TYPES),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(false),
  status: z.enum(DIGITAL_EMPLOYEE_STATUSES).default('draft'),
  profile: DigitalEmployeeProfileSchema.default({
    roleDescription: '',
    workBoundary: '',
    tone: 'professional',
    defaultDeliverableFormat: 'concise answer'
  }),
  knowledgeScope: KnowledgeScopeSchema.default({
    knowledgeBaseIds: [],
    minScore: 0.4,
    citeSources: true,
    conflictPolicy: 'draft_approval'
  }),
  expertAssignment: ExpertAssignmentSchema.default({
    expertId: '',
    expertTeamId: '',
    collaborationMode: 'lead_only',
    escalationRules: []
  }),
  autoReplyPolicy: AutoReplyPolicySchema.default({
    enabled: false,
    actionLevel: 'draft',
    allowExternalSend: false,
    maxRepliesPerHour: 12,
    maxRepliesPerThreadPerDay: 3,
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    allowList: [],
    denyList: [],
    requireApprovalRiskAtOrAbove: 'medium',
    requireApprovalKeywords: []
  }),
  approvalPolicy: ApprovalPolicySchema.default({
    mode: 'risk_based',
    requireApprovalRiskAtOrAbove: 'medium',
    timeoutMinutes: 1440,
    allowApproverEdit: true
  }),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type DigitalEmployee = z.infer<typeof DigitalEmployeeSchema>

// ─── Automation Task ───

export const RiskAssessmentSchema = z.object({
  level: z.enum(AUTOMATION_RISK_LEVELS),
  reasons: z.array(z.string()),
  matchedRules: z.array(z.string()),
  requiresApproval: z.boolean(),
  policyDecision: z.string()
})
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>

export const AutomationTaskSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  source: z.enum(AUTOMATION_TASK_SOURCES),
  status: z.enum(AUTOMATION_TASK_STATUSES),
  actionLevel: z.enum(AUTOMATION_ACTION_LEVELS),
  inputText: z.string().default(''),
  outputText: z.string().default(''),
  prompt: z.string().default(''),
  risk: RiskAssessmentSchema.optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().default(0),
  toolCallCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional()
})
export type AutomationTask = z.infer<typeof AutomationTaskSchema>

// ─── Approval ───

export const AutomationApprovalSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  employeeId: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  riskLevel: z.enum(AUTOMATION_RISK_LEVELS),
  proposedOutput: z.string(),
  approverEditedOutput: z.string().optional(),
  decisionNote: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  expiresAt: z.string().optional()
})
export type AutomationApproval = z.infer<typeof AutomationApprovalSchema>

// ─── Execution Log ───

export const ExecutionLogSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  employeeId: z.string().min(1),
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  category: z.string(),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).optional()
})
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>

// ─── Scheduled Task ───

export const ScheduledTaskSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  cron: z.string().min(1),
  timezone: z.string().default('UTC'),
  prompt: z.string().default(''),
  inputScope: z.object({
    folders: z.array(z.string()).default([]),
    labels: z.array(z.string()).default([]),
    unreadOnly: z.boolean().default(true)
  }).default({ folders: [], labels: [], unreadOnly: true }),
  failurePolicy: z.object({
    maxRetries: z.number().int().nonnegative().default(2),
    retryDelayMinutes: z.number().positive().default(5),
    notifyOnFailure: z.boolean().default(true)
  }).default({ maxRetries: 2, retryDelayMinutes: 5, notifyOnFailure: true }),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>

// ─── Automation Settings ───

export const AutomationDefaultsSchema = z.object({
  actionLevel: z.enum(AUTOMATION_ACTION_LEVELS).default('draft'),
  autoReplyEnabled: z.boolean().default(false),
  maxAutoRepliesPerHour: z.number().int().positive().default(12),
  riskThreshold: z.enum(AUTOMATION_RISK_LEVELS).default('medium'),
  approvalPolicy: ApprovalPolicySchema.default({
    mode: 'manual',
    requireApprovalRiskAtOrAbove: 'medium',
    timeoutMinutes: 30,
    allowApproverEdit: true
  })
})
export type AutomationDefaults = z.infer<typeof AutomationDefaultsSchema>

export const AutomationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  employees: z.array(DigitalEmployeeSchema).default([]),
  defaults: AutomationDefaultsSchema.default({
    actionLevel: 'draft',
    autoReplyEnabled: false,
    maxAutoRepliesPerHour: 12,
    riskThreshold: 'medium',
    approvalPolicy: {
      mode: 'manual',
      requireApprovalRiskAtOrAbove: 'medium',
      timeoutMinutes: 30,
      allowApproverEdit: true
    }
  }),
  schedules: z.array(ScheduledTaskSchema).default([])
})
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>

// ─── Filter Types ───

export type AutomationTaskFilter = {
  employeeId?: string
  status?: AutomationTaskStatus[]
  source?: AutomationTaskSource[]
  limit?: number
  offset?: number
}

export type AutomationApprovalFilter = {
  employeeId?: string
  status?: Array<'pending' | 'approved' | 'rejected' | 'expired'>
  limit?: number
  offset?: number
}

export type AutomationLogFilter = {
  taskId?: string
  employeeId?: string
  level?: Array<'info' | 'warn' | 'error'>
  limit?: number
  offset?: number
}

// ─── Metrics ───

export const AutomationMetricsSchema = z.object({
  totalTasks: z.number().int().nonnegative().default(0),
  completedTasks: z.number().int().nonnegative().default(0),
  failedTasks: z.number().int().nonnegative().default(0),
  cancelledTasks: z.number().int().nonnegative().default(0),
  pendingApprovals: z.number().int().nonnegative().default(0),
  totalTokensUsed: z.number().int().nonnegative().default(0),
  avgResponseTimeMs: z.number().nonnegative().default(0),
  lastUpdated: z.string().optional()
})
export type AutomationMetrics = z.infer<typeof AutomationMetricsSchema>

// ─── Sensitive Keywords ───

export const DEFAULT_SENSITIVE_KEYWORDS = [
  'contract', 'quote', 'invoice', 'payment', 'refund', 'legal',
  'salary', 'medical', 'investment', 'confidential', 'nda', 'password',
  'token', 'secret',
  '合同', '报价', '发票', '付款', '退款', '法律', '人事', '薪资', '医疗', '投资', '保密'
]
