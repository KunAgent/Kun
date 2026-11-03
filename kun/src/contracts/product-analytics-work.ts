// Shared by the renderer and Runtime; no platform dependencies or user content.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const WORK_REQUEST = new RegExp(`^turn_work_(${UUID})_${UUID}$`, 'i')

export function workRequestEpoch(id: string | undefined): string | null {
  return typeof id === 'string' ? WORK_REQUEST.exec(id)?.[1] ?? null : null
}

export function workRunKeySource(id: string): string { return `work:${id}` }
