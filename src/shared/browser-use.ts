import { z } from 'zod'

export const BROWSER_USE_CONTRACT_VERSION = 1 as const

export const BrowserUseModeSchema = z.enum(['public', 'local-development'])
export type BrowserUseMode = z.infer<typeof BrowserUseModeSchema>

export const BrowserUseCapabilityStatusSchema = z.enum([
  'disabled',
  'available',
  'unavailable',
  'interaction-required'
])
export type BrowserUseCapabilityStatus = z.infer<typeof BrowserUseCapabilityStatusSchema>

export const BrowserUseControlOwnerSchema = z.enum(['agent', 'manual'])
export type BrowserUseControlOwner = z.infer<typeof BrowserUseControlOwnerSchema>

export const BrowserUseLifecycleSchema = z.enum([
  'closed',
  'mount-required',
  'ready',
  'loading',
  'waiting-origin-consent',
  'waiting-action-consent',
  'manual-control',
  'stopped',
  'error'
])
export type BrowserUseLifecycle = z.infer<typeof BrowserUseLifecycleSchema>

export const BrowserUseRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative()
}).strict()
export type BrowserUseRect = z.infer<typeof BrowserUseRectSchema>

export const BrowserUseRiskSchema = z.enum(['navigation', 'interaction', 'text-entry'])
export type BrowserUseRisk = z.infer<typeof BrowserUseRiskSchema>

export const BrowserUseOriginConsentRequestSchema = z.object({
  id: z.string().min(16).max(256),
  sessionId: z.string().min(16).max(256),
  threadId: z.string().min(1).max(256),
  origin: z.string().url().max(2048),
  sanitizedUrl: z.string().max(2048),
  mode: BrowserUseModeSchema,
  createdAt: z.string().datetime()
}).strict()
export type BrowserUseOriginConsentRequest = z.infer<typeof BrowserUseOriginConsentRequestSchema>

export const BrowserUseActionConsentRequestSchema = z.object({
  id: z.string().min(16).max(256),
  sessionId: z.string().min(16).max(256),
  threadId: z.string().min(1).max(256),
  tabId: z.string().min(1).max(256),
  origin: z.string().url().max(2048),
  pageTitle: z.string().max(512),
  action: z.enum(['click', 'type', 'select', 'press']),
  risk: BrowserUseRiskSchema,
  targetRole: z.string().max(128),
  targetName: z.string().max(512),
  textPreview: z.string().max(512).optional(),
  targetRect: BrowserUseRectSchema,
  previewDataUrl: z.string().startsWith('data:image/').max(2_500_000).optional(),
  expiresAt: z.string().datetime()
}).strict()
export type BrowserUseActionConsentRequest = z.infer<typeof BrowserUseActionConsentRequestSchema>

export const BrowserUseTabStateSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().max(512),
  origin: z.string().max(2048),
  sanitizedUrl: z.string().max(2048),
  active: z.boolean(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean()
}).strict()
export type BrowserUseTabState = z.infer<typeof BrowserUseTabStateSchema>

export const BrowserUseBudgetStateSchema = z.object({
  observationRemaining: z.number().int().nonnegative(),
  interactionRemaining: z.number().int().nonnegative()
}).strict()
export type BrowserUseBudgetState = z.infer<typeof BrowserUseBudgetStateSchema>

export const BrowserUseViewStateSchema = z.object({
  contractVersion: z.literal(BROWSER_USE_CONTRACT_VERSION),
  capabilityStatus: BrowserUseCapabilityStatusSchema,
  reason: z.string().max(1024).optional(),
  sessionId: z.string().min(16).max(256).optional(),
  threadId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional(),
  lifecycle: BrowserUseLifecycleSchema,
  controlOwner: BrowserUseControlOwnerSchema,
  visible: z.boolean(),
  mounted: z.boolean(),
  mode: BrowserUseModeSchema,
  tabs: z.array(BrowserUseTabStateSchema).max(3),
  activeTabId: z.string().min(1).max(256).optional(),
  budget: BrowserUseBudgetStateSchema.optional(),
  pendingOriginConsent: BrowserUseOriginConsentRequestSchema.optional(),
  pendingActionConsent: BrowserUseActionConsentRequestSchema.optional(),
  updatedAt: z.string().datetime()
}).strict()
export type BrowserUseViewState = z.infer<typeof BrowserUseViewStateSchema>

export const BrowserUseMountInputSchema = z.object({
  expectedTurnId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256),
  visible: z.boolean(),
  supervisionActive: z.boolean(),
  bounds: BrowserUseRectSchema
}).strict()
export type BrowserUseMountInput = z.infer<typeof BrowserUseMountInputSchema>

export const BrowserUseDecisionInputSchema = z.object({
  expectedTurnId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256),
  requestId: z.string().min(16).max(256),
  decision: z.enum(['allow-once', 'deny'])
}).strict()
export type BrowserUseDecisionInput = z.infer<typeof BrowserUseDecisionInputSchema>

export const BrowserUseControlInputSchema = z.object({
  expectedTurnId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256),
  controlOwner: BrowserUseControlOwnerSchema
}).strict()
export type BrowserUseControlInput = z.infer<typeof BrowserUseControlInputSchema>

export const BrowserUseThreadInputSchema = z.object({
  expectedTurnId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256)
}).strict()
export type BrowserUseThreadInput = z.infer<typeof BrowserUseThreadInputSchema>

export const BrowserUseNavigationInputSchema = z.object({
  expectedTurnId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256),
  command: z.enum(['back', 'forward', 'reload'])
}).strict()
export type BrowserUseNavigationInput = z.infer<typeof BrowserUseNavigationInputSchema>

export const BrowserUseAuditEntrySchema = z.object({
  id: z.string().min(16).max(256),
  timestamp: z.string().datetime(),
  threadId: z.string().min(1).max(256),
  sessionId: z.string().min(16).max(256),
  tabId: z.string().min(1).max(256).optional(),
  category: z.enum(['lifecycle', 'network-policy', 'origin-consent', 'action-consent', 'execution']),
  action: z.string().max(64),
  origin: z.string().max(2048).optional(),
  sanitizedPath: z.string().max(2048).optional(),
  risk: BrowserUseRiskSchema.optional(),
  reviewerSource: z.enum(['user', 'agent', 'full-access']).optional(),
  decision: z.enum(['allowed', 'denied', 'expired', 'cancelled']).optional(),
  outcome: z.enum(['success', 'blocked', 'error', 'aborted']),
  targetLabel: z.string().max(256).optional(),
  errorCode: z.string().max(128).optional()
}).strict()
export type BrowserUseAuditEntry = z.infer<typeof BrowserUseAuditEntrySchema>
