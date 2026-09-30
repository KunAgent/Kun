/** Dependency-free channel identities for the sandboxed preload and trusted host. */
export const GOOGLE_WORKSPACE_CHANNELS = {
  status: 'google-workspace:status',
  login: 'google-workspace:login',
  setup: 'google-workspace:setup',
  logout: 'google-workspace:logout',
  test: 'google-workspace:test',
  cancel: 'google-workspace:cancel',
  openAuthorization: 'google-workspace:open-authorization'
} as const
