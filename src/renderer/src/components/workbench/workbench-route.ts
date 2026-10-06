/**
 * Standalone Design and Rooms are no longer active workbench destinations.
 * Keep the legacy route values readable, but project them through the Code
 * shell: Design as a Kun surface, Rooms as Code conversations.
 */
export function normalizeWorkbenchRoute(route: string): string {
  if (route === 'design' || route === 'ade') return 'chat'
  if (route === 'rooms') return 'agent-chat'
  return new Set([
    'chat', 'agent-chat', 'write', 'settings', 'plugins', 'extensions', 'claw', 'board', 'schedule', 'workflow'
  ]).has(route) ? route : 'chat'
}
