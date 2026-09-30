export { GOOGLE_WORKSPACE_CHANNELS } from './google-workspace-channels'

export const GOOGLE_WORKSPACE_RUNTIME_PATH = '/v1/integrations/google-workspace'
export const GOOGLE_WORKSPACE_DOCUMENTATION_URL =
  'https://github.com/googleworkspace/cli/blob/v0.22.5/README.md#manual-oauth-setup-google-cloud-console'

// Keep this contract dependency-free: sandboxed preloads cannot require npm
// packages. Runtime response validation belongs in main/google-workspace-schema.
type GoogleWorkspaceServiceStatus = {
  state: 'unknown' | 'ready' | 'error'
  message?: string
}

export type GoogleWorkspaceStatus = {
  experimental: true
  binary: { available: boolean; version?: string; error?: string }
  auth: {
    state: 'connected' | 'disconnected' | 'setup_required' | 'error'
    scopes: string[]
  }
  operation?: {
    id: string
    kind: GoogleWorkspaceAction
    state: 'running' | 'succeeded' | 'cancelled' | 'failed'
    message?: string
  }
  services: {
    gmail: GoogleWorkspaceServiceStatus
    calendar: GoogleWorkspaceServiceStatus
    drive: GoogleWorkspaceServiceStatus
  }
  setup?: { required: boolean; instructions: string[]; documentationUrl: string }
}

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
