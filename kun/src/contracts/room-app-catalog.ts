/** Built-in remote apps that a Room Agent may request before configuration. */
export const ROOM_APP_CATALOG: Readonly<Record<string, { name: string; url: string }>> = {}

/** Previously suggested Google Workspace servers are unavailable to private Rooms. */
export const HIDDEN_ROOM_GOOGLE_APP_IDS = [
  'google_gmail', 'google_drive', 'google_calendar', 'google_chat', 'google_people',
  'gmail', 'drive', 'calendar'
] as const

export function isHiddenRoomGoogleApp(value: string): boolean {
  const id = value.trim().toLowerCase().replace(/^mcp:/, '')
  return HIDDEN_ROOM_GOOGLE_APP_IDS.some((hidden) => hidden === id)
}

export function canonicalRoomAppId(value: string): string {
  const id = value.trim().toLowerCase()
  return id === 'gmail' ? 'google_gmail' : id === 'drive' ? 'google_drive' :
    id === 'calendar' ? 'google_calendar' : id
}
