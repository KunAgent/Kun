export const GOOGLE_WORKSPACE_VERSION = '0.22.5'
export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly'
] as const
export const GOOGLE_WORKSPACE_IDENTITY_SCOPES = [
  'openid', 'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
] as const
export type GoogleWorkspaceServiceState = { state: 'unknown' | 'ready' | 'error'; message?: string }
export type GoogleWorkspaceStatus = {
  experimental: true
  binary: { available: boolean; version?: string; error?: string }
  auth: { state: 'connected' | 'disconnected' | 'setup_required' | 'error'; scopes: string[] }
  operation?: {
    id: string
    kind: 'login' | 'setup' | 'test' | 'logout'
    state: 'running' | 'succeeded' | 'cancelled' | 'failed'
    message?: string
  }
  services: { gmail: GoogleWorkspaceServiceState; calendar: GoogleWorkspaceServiceState; drive: GoogleWorkspaceServiceState }
  setup: { required: boolean; instructions: string[]; documentationUrl: string }
}
export const GOOGLE_WORKSPACE_SETUP = {
  documentationUrl: 'https://github.com/googleworkspace/cli/blob/v0.22.5/README.md#manual-oauth-setup-google-cloud-console',
  instructions: [
    'Create or choose your Google Cloud project. Enable the Gmail API, Google Calendar API and Google Drive API.',
    'Configure the OAuth consent screen and add your Google account as a test user if the app is in testing.',
    'Create an OAuth client of type Desktop app. Download its JSON yourself and place it at ~/.config/gws/client_secret.json (all platforms). Kun does not receive or read this file.',
    'Return here and choose Connect. The bundled gws process owns OAuth and its local credential storage. Google opens in your browser.',
    'Alternatively, run gws auth setup yourself in an interactive terminal if you have gcloud installed and authenticated. Kun does not provision Google projects or run gcloud.',
    'gws may use the OS keyring or a local encryption-key file. Disconnect removes local gws credentials and token caches; revoke consent separately in your Google account if needed.'
  ]
}
