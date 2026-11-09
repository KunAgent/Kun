const sessions = new Set<{ close(reason?: string): Promise<void> }>()
export function registerComputerSession(session: { close(reason?: string): Promise<void> }) {
  sessions.add(session)
  return () => sessions.delete(session)
}
export async function stopComputerSessions(reason = 'application_quit') {
  await Promise.all([...sessions].map(session => session.close(reason)))
}
