import { z } from 'zod'

export const ANALYTICS_VERSION = 1 as const
export const ANALYTICS_POLICY = 'product-analytics-v1'
export const AnalyticsMode = z.enum(['code', 'room'])
export const AnalyticsSurface = z.enum(['desktop', 'mobile_web', 'mobile_native', 'execution_host'])
export const AnalyticsFailure = z.enum(['network', 'authentication', 'quota', 'permission', 'configuration', 'runtime', 'unknown'])
const Props = z.object({
  mode: AnalyticsMode.optional(),
  scope: z.enum(['personal', 'shared']).optional(),
  operation: z.enum(['send_message', 'start_task', 'continue_task']).optional(),
  requestOutcome: z.enum(['accepted', 'failed', 'unknown']).optional(),
  step: z.enum(['welcome', 'model', 'permission', 'agents', 'account', 'ready', 'first_task']).optional(),
  action: z.enum(['entered', 'completed', 'skipped', 'copy', 'continue', 'selected']).optional(),
  status: z.enum(['completed', 'failed', 'cancelled']).optional(),
  errorCategory: AnalyticsFailure.optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  outputPresent: z.boolean().optional(),
  runKey: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()
export const AnalyticsInput = z.object({
  name: z.enum(['app_session_started', 'onboarding_step', 'provider_check_finished',
    'remote_action_finished', 'workspace_ready', 'account_session_ready', 'run_started', 'run_finished', 'result_presented', 'result_action']),
  properties: Props.default({})
}).strict()
export type AnalyticsInput = z.input<typeof AnalyticsInput>
export const AnalyticsEvent = AnalyticsInput.extend({
  eventId: z.string().uuid(), occurredAt: z.string().datetime(), schemaVersion: z.literal(1),
  surface: AnalyticsSurface, sessionId: z.string().uuid(),
  appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,80}$/),
  platform: z.enum(['macos', 'windows', 'linux', 'ios', 'android', 'web']),
  observation: z.enum(['ui', 'runtime'])
}).strict()
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>
export const AnalyticsConfig = z.object({
  schemaVersion: z.literal(1), collectionEnabled: z.boolean(), guidanceEnabled: z.boolean(),
  policyVersion: z.literal(ANALYTICS_POLICY)
}).strip()
export type AnalyticsConfig = z.infer<typeof AnalyticsConfig>
export type AnalyticsState = {
  enabled: boolean
  epoch?: string
  installation: 'existing' | 'fresh' | 'unknown'
  guidance: boolean
  available: boolean
}
export interface ProductAnalyticsApi {
  getState(): Promise<AnalyticsState>
  setEnabled(enabled: boolean): Promise<AnalyticsState>
  track(input: AnalyticsInput, epoch?: string): Promise<void>
  guidance(): Promise<boolean>
}
export const ANALYTICS_LIMITS = { events: 1000, bytes: 2 * 1024 * 1024, batch: 50, ageMs: 7 * 86_400_000 } as const
