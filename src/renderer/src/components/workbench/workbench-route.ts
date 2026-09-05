/**
 * Standalone Design is no longer an active workbench destination. Keep the
 * legacy route value readable, but project it through the Code shell.
 */
export function normalizeWorkbenchRoute(route: string): string {
  if (route === 'design') return 'chat'
  return new Set([
    'chat', 'write', 'settings', 'plugins', 'extensions', 'claw', 'board', 'schedule', 'workflow'
  ]).has(route) ? route : 'chat'
}
