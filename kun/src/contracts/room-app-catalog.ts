/** Built-in remote apps that a Room Agent may request before configuration. */
export const ROOM_APP_CATALOG = {
  google_gmail: { name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1' },
  google_drive: { name: 'Google Drive', url: 'https://drivemcp.googleapis.com/mcp/v1' },
  google_calendar: { name: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1' }
} as const

export function canonicalRoomAppId(value: string): string {
  const id = value.trim().toLowerCase()
  return id === 'gmail' ? 'google_gmail' : id === 'drive' ? 'google_drive' :
    id === 'calendar' ? 'google_calendar' : id
}
