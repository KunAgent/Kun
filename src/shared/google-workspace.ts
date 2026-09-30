import { z } from 'zod'

export { GOOGLE_WORKSPACE_CHANNELS } from './google-workspace-channels'

export const GOOGLE_WORKSPACE_RUNTIME_PATH = '/v1/integrations/google-workspace'
export const GOOGLE_WORKSPACE_DOCUMENTATION_URL =
  'https://github.com/googleworkspace/cli/blob/v0.22.5/README.md#manual-oauth-setup-google-cloud-console'

const serviceStatusSchema = z.object({
  state: z.enum(['unknown', 'ready', 'error']),
  message: z.string().max(1_000).optional()
})

// Runtime responses are intentionally projected through a closed field list.
// No credentials, account identifiers, process output, or OAuth URLs enter IPC.
export const googleWorkspaceStatusSchema = z.object({
  experimental: z.literal(true),
  binary: z.object({
    available: z.boolean(),
    version: z.string().max(100).optional(),
    error: z.string().max(1_000).optional()
  }),
  auth: z.object({
    state: z.enum(['connected', 'disconnected', 'setup_required', 'error']),
    scopes: z.array(z.string().max(200)).max(32)
  }),
  operation: z.object({
    id: z.string().min(1).max(128),
    kind: z.enum(['login', 'setup', 'test', 'logout']),
    state: z.enum(['running', 'succeeded', 'cancelled', 'failed']),
    message: z.string().max(1_000).optional()
  }).optional(),
  services: z.object({
    gmail: serviceStatusSchema,
    calendar: serviceStatusSchema,
    drive: serviceStatusSchema
  }),
  setup: z.object({
    required: z.boolean(),
    instructions: z.array(z.string().max(2_000)).max(20),
    documentationUrl: z.string().max(2_048)
  }).optional()
})

export type GoogleWorkspaceStatus = z.infer<typeof googleWorkspaceStatusSchema>
export type GoogleWorkspaceAction = 'login' | 'setup' | 'test' | 'logout'
export type GoogleWorkspaceApi = {
  status: () => Promise<GoogleWorkspaceStatus>
  login: () => Promise<GoogleWorkspaceStatus>
  setup: () => Promise<GoogleWorkspaceStatus>
  logout: () => Promise<GoogleWorkspaceStatus>
  test: () => Promise<GoogleWorkspaceStatus>
  cancel: () => Promise<GoogleWorkspaceStatus>
  /** Main retrieves and validates the current URL; renderer supplies no URL. */
  openAuthorization: () => Promise<{ opened: boolean }>
}

export type GoogleWorkspaceSurface = { googleWorkspace: GoogleWorkspaceApi }
