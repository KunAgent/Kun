import { z } from 'zod'

const common = {
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  appId: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  runtimeProviderId: z.string().min(1),
  name: z.string().min(1),
  availability: z.enum(['ready', 'planned', 'vendor_approval']),
  platforms: z.array(z.enum(['darwin', 'win32', 'linux'])),
  docsUrl: z.string().url()
}

const oauth = z.object({ ...common, kind: z.literal('mcp_oauth'),
  endpoint: z.string().url().refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    } catch { return false }
  }), registration: z.enum(['discover', 'pre_registered']) }).strict()
const local = z.object({ ...common, kind: z.literal('mcp_local'),
  endpoint: z.literal('http://127.0.0.1:3845/mcp') }).strict()
const github = z.object({ ...common, kind: z.literal('native_github') }).strict()
const gmail = z.object({ ...common, kind: z.literal('native_gmail') }).strict()
const figma = z.object({ ...common, kind: z.literal('native_figma') }).strict()

export const AppPresetSchema = z.discriminatedUnion('kind', [oauth, local, github, gmail, figma])
export type AppPreset = z.infer<typeof AppPresetSchema>
export type AppConnectionKind = AppPreset['kind']

/**
 * Aggregated, credential-free connection state. Account readiness, transport
 * readiness, and per-conversation permission stay separate: this view never
 * implies that any conversation may already use the tools.
 */
export const AppConnectionStatusSchema = z.object({
  presetId: z.string().min(1),
  appId: z.string().min(1),
  runtimeProviderId: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  availability: z.enum(['ready', 'planned', 'vendor_approval']),
  platformSupported: z.boolean(),
  installed: z.boolean(),
  accountStatus: z.enum(['connected', 'disconnected', 'pending', 'error', 'unavailable']),
  transportStatus: z.enum(['ready', 'unreachable', 'unknown', 'not_applicable']),
  accountLabel: z.string().max(256).optional(),
  workspaceLabel: z.string().max(256).optional(),
  toolCount: z.number().int().min(0),
  errorCode: z.string().max(64).optional(),
  errorMessage: z.string().max(512).optional(),
  nextAction: z.string().max(64).optional(),
  revision: z.number().int().min(0)
}).strict()
export type AppConnectionStatus = z.infer<typeof AppConnectionStatusSchema>

export const APP_CONNECTION_ERRORS = [
  'not_found',
  'not_ready',
  'platform_unsupported',
  'unsupported_operation',
  'credential_required',
  'credential_rejected',
  'credential_store_unavailable',
  'connect_failed'
] as const
export type AppConnectionErrorCode = (typeof APP_CONNECTION_ERRORS)[number]

export class AppConnectionError extends Error {
  constructor(readonly code: AppConnectionErrorCode, message: string) {
    super(message)
    this.name = 'AppConnectionError'
  }
}
