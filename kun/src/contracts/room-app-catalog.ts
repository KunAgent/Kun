import { APP_PRESETS } from './app-connection-catalog.js'

/** Built-in apps currently available for a Room Agent to request. */
export const ROOM_APP_CATALOG: Readonly<Record<string, {
  name: string
  url?: string
  connectionKind?: 'native_gmail' | 'native_github'
}>> = Object.fromEntries(APP_PRESETS.flatMap((preset) => {
  if (preset.availability !== 'ready' || (preset.kind !== 'native_gmail' && preset.kind !== 'native_github')) return []
  return [[preset.id, { name: preset.name, connectionKind: preset.kind }]]
}))

/** Previously suggested Google Workspace servers are unavailable to private Rooms. */
export const HIDDEN_ROOM_GOOGLE_APP_IDS = [
  'google_drive', 'google_calendar', 'google_chat', 'google_people', 'drive', 'calendar'
] as const

/** Legacy remote Google tools remain unavailable; Gmail uses the native consent boundary. */
export const HIDDEN_ROOM_GOOGLE_MCP_IDS = [...HIDDEN_ROOM_GOOGLE_APP_IDS, 'google_gmail', 'gmail'] as const

export function isHiddenRoomGoogleApp(value: string): boolean {
  const id = value.trim().toLowerCase().replace(/^mcp:/, '')
  return HIDDEN_ROOM_GOOGLE_APP_IDS.some((hidden) => hidden === id)
}

export function canonicalRoomAppId(value: string): string {
  const id = value.trim().toLowerCase()
  return id === 'gmail' ? 'google_gmail' : id === 'drive' ? 'google_drive' :
    id === 'calendar' ? 'google_calendar' : id
}
