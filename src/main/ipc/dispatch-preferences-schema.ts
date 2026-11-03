import { z } from 'zod'
import { ADE_DISPATCH_PREFERENCE_MAX_RULES } from '../../shared/ade-collaboration-settings'

export const dispatchPreferencesSchema = z.array(z.object({
  id: z.string().trim().min(1).max(128),
  scenario: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(64),
  agentLabel: z.string().trim().max(80).optional(),
  model: z.string().trim().min(1).max(512).optional(),
  providerId: z.string().trim().min(1).max(128).optional(),
  credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
  note: z.string().trim().max(300).optional(),
  enabled: z.boolean()
}).strict()).max(ADE_DISPATCH_PREFERENCE_MAX_RULES).refine(
  (rules) => new Set(rules.map((rule) => rule.id)).size === rules.length,
  'Preference ids must be unique.'
)
