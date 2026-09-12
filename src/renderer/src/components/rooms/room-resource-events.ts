import { roomsRequest } from './rooms-client'
type RoomEvent = { kind: string; roomId: string; payload?: { id?: string; taskId?: string } }
const reads = new Map<string, Promise<unknown>>()
export function invalidateRoomRead(path: string) { reads.delete(path) }
export function sharedRoomRead<T>(path: string): Promise<T> {
  const existing = reads.get(path)
  if (existing) return existing as Promise<T>
  const pending = roomsRequest<T>(path).finally(() => { if (reads.get(path) === pending) reads.delete(path) })
  reads.set(path, pending)
  return pending
}
export function roomResourceAffected(path: string, event: RoomEvent): boolean {
  const route = path.split('?')[0]
  const task = route.match(/\/tasks\/([^/]+)/)?.[1]
  if (task && event.payload?.taskId && event.payload.taskId !== decodeURIComponent(task)) return false
  if (task && event.kind.startsWith('task.') && event.payload?.id !== decodeURIComponent(task)) return false
  if (route.includes('/topics')) return event.kind.startsWith('peer.')
  if (route.includes('/requests')) {
    const request = route.match(/\/requests\/([^/]+)/)?.[1]
    if (event.kind.startsWith('rule_compression.')) return Boolean(request)
    if (!/^(request|outcome)\./.test(event.kind)) return false
    return !request || !event.payload?.id || event.payload.id === decodeURIComponent(request)
  }
  if (route.includes('/rules') || route.includes('/agreements')) return event.kind.startsWith('rule.')
  if (route.includes('/integrations')) return event.kind.startsWith('integration.')
  if (route.includes('/deliveries') || route.includes('/reviews') || route.includes('/diff') || route.includes('/logs')) {
    return /^(delivery|review)\./.test(event.kind)
  }
  if (task) return /^(task|delivery|review|integration)\./.test(event.kind)
  return true
}
