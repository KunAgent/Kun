/**
 * Standalone Design is no longer an active workbench destination. Keep the
 * legacy route value readable, but project it through the Code shell.
 */
export function normalizeWorkbenchRoute(route: string): string {
  if (route === 'design' || route === 'ade') return 'chat'
  return new Set([
    'chat', 'agent-chat', 'write', 'rooms', 'settings', 'plugins', 'extensions', 'claw', 'board', 'schedule', 'workflow', 'ade'
  ]).has(route) ? route : 'chat'
}
