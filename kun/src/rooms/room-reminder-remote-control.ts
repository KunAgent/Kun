import { RoomIdSchema } from '../contracts/rooms.js'
import { RoomStoreConflictError } from './room-store.js'
import { interactionFingerprint } from './room-interaction-store.js'
/** Internal-only authority: JSON, HTTP request bodies and model tools cannot create this symbol. */
export const REMOTE_REMINDER_RESUME = Symbol('remote-reminder-resume')
export type RemoteReminderResume = { [REMOTE_REMINDER_RESUME]?: { deviceId: string } }
export function remoteReminderDevice(input: RemoteReminderResume & { paused?: boolean }) {
  const source = input[REMOTE_REMINDER_RESUME]
  if (!source) return undefined
  if (input.paused !== false) throw new RoomStoreConflictError('remote reminder authority only narrows a resume')
  return RoomIdSchema.parse(source.deviceId)
}
export function reminderUpdateFingerprint(roomId: string, reminderId: string,
  input: RemoteReminderResume & { paused?: boolean; [key: string]: unknown }) {
  const deviceId = remoteReminderDevice(input)
  return interactionFingerprint({ roomId, reminderId, ...input,
    ...(deviceId ? { remoteResume: { deviceId, clientSurface: 'api' } } : {}) })
}
