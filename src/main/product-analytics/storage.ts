import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AnalyticsEvent, ANALYTICS_LIMITS } from '../../shared/product-analytics'
import { settingsReadCandidates } from '../settings-file-paths'

export type Installation = 'existing' | 'fresh' | 'unknown'
let installation: Installation = 'unknown'
/** Call before migrations/default settings create files. Read errors are never evidence of a fresh install. */
export async function detectAnalyticsInstallation(userData: string, runtimeDir: string): Promise<void> {
  try {
    for (const path of [...settingsReadCandidates(userData), runtimeDir,
      join(userData, 'kun-account'), join(userData, 'Local Storage')]) {
      try { await access(path); installation = 'existing'; return }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    installation = 'fresh'
  } catch { installation = 'unknown' }
}
export const AnalyticsDiskState = z.object({
  version: z.literal(1), enabled: z.boolean(), installation: z.enum(['existing', 'fresh', 'unknown']),
  installationId: z.string().uuid().nullable(), epoch: z.string().uuid(), actor: z.string().nullable(),
  pendingRuntimeClear: z.string().uuid().nullable().default(null),
  events: z.array(AnalyticsEvent).max(1000)
}).strict()
export type AnalyticsDiskState = z.infer<typeof AnalyticsDiskState>
export function emptyAnalyticsState(): AnalyticsDiskState {
  return { version: 1, enabled: false, installation, installationId: null, epoch: randomUUID(), actor: null, pendingRuntimeClear: null, events: [] }
}
export interface AnalyticsStorage { read(): Promise<AnalyticsDiskState>; write(state: AnalyticsDiskState): Promise<void> }
const WorkSidecar = z.object({
  version: z.literal(1), epoch: z.string().uuid(), actor: z.string().nullable(),
  installationId: z.string().uuid().nullable(), events: z.array(AnalyticsEvent).max(ANALYTICS_LIMITS.events)
}).strict()
const isWork = (event: AnalyticsEvent): boolean => event.properties.mode === 'work' || event.name.startsWith('work_')
function legacyCompatible(event: AnalyticsEvent): boolean {
  const properties = event.properties
  return !isWork(event) && properties.feedbackKind === undefined && properties.waitKind === undefined &&
    properties.waitOutcome === undefined && properties.action !== 'save' && properties.action !== 'export'
}
function retainedEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const seen = new Set<string>()
  return events.filter(event => {
    if (seen.has(event.eventId) || Date.now() - Date.parse(event.occurredAt) >= ANALYTICS_LIMITS.ageMs) return false
    seen.add(event.eventId); return true
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)).slice(-ANALYTICS_LIMITS.events)
}
async function atomicWrite(path: string, text: string): Promise<void> {
  const temp = path + '.' + randomUUID()
  try { await writeFile(temp, text, { mode: 0o600 }); await rename(temp, path) }
  finally { await rm(temp, { force: true }).catch(() => {}) }
}
export function analyticsStorage(path: string): AnalyticsStorage {
  const workPath = path + '.work-v1.json'
  return {
    async read() {
      let base: AnalyticsDiskState, baseBytes: number
      try {
        const raw = await readFile(path, 'utf8'); baseBytes = Buffer.byteLength(raw)
        if (baseBytes > ANALYTICS_LIMITS.bytes) return emptyAnalyticsState()
        base = AnalyticsDiskState.parse(JSON.parse(raw))
      } catch { return emptyAnalyticsState() }
      // Work never controls the legacy consent/identity. Corrupt or stale sidecars
      // cannot reset a valid Code/Room state or restore a previous actor's queue.
      let events = base.events
      if (base.enabled) {
        try {
          const raw = await readFile(workPath, 'utf8')
          if (baseBytes + Buffer.byteLength(raw) <= ANALYTICS_LIMITS.bytes) {
            const work = WorkSidecar.parse(JSON.parse(raw))
            if (work.epoch === base.epoch && work.actor === base.actor && work.installationId === base.installationId)
              events = [...events, ...work.events.filter(isWork)]
          }
        } catch { /* Sidecar failure never discards the legacy state. */ }
      }
      return { ...base, events: retainedEvents(base.enabled ? events : events.filter(event => !isWork(event))) }
    },
    async write(state) {
      const events = retainedEvents(state.events)
      // Keep exactly the old strict shape and old event enums in state.v1.json.
      const baseText = JSON.stringify({ ...state, events: events.filter(legacyCompatible) })
      const workEvents = state.enabled ? events.filter(isWork) : []
      const workText = workEvents.length ? JSON.stringify({ version: 1, epoch: state.epoch,
        actor: state.actor, installationId: state.installationId, events: workEvents }) : null
      if (Buffer.byteLength(baseText) + (workText ? Buffer.byteLength(workText) : 0) > ANALYTICS_LIMITS.bytes)
        throw new Error('analytics_queue_limit')
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      // Identity/consent commits first: even a crash or failed sidecar write leaves
      // old Work invalidated by the newly committed epoch/actor/disabled state.
      await atomicWrite(path, baseText)
      if (workText) await atomicWrite(workPath, workText)
      else await rm(workPath, { force: true }).catch(() => {})
    }
  }
}
