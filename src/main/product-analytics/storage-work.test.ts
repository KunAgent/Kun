import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AnalyticsEvent, ANALYTICS_LIMITS } from '../../shared/product-analytics'
import { analyticsStorage, emptyAnalyticsState, type AnalyticsDiskState } from './storage'

// Frozen pre-Work wire shape from HEAD before the feature: strict properties,
// event names and top-level state. Do not derive these enums from the new schema.
const LegacyProps = z.object({
  mode: z.enum(['code', 'room']).optional(), scope: z.enum(['personal', 'shared']).optional(),
  operation: z.enum(['send_message', 'start_task', 'continue_task']).optional(),
  requestOutcome: z.enum(['accepted', 'failed', 'unknown']).optional(),
  step: z.enum(['welcome', 'model', 'permission', 'agents', 'account', 'ready', 'first_task']).optional(),
  action: z.enum(['entered', 'completed', 'skipped', 'copy', 'continue', 'selected']).optional(),
  status: z.enum(['completed', 'failed', 'cancelled']).optional(),
  errorCategory: z.enum(['network', 'authentication', 'quota', 'permission', 'configuration', 'runtime', 'unknown']).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(), outputPresent: z.boolean().optional(),
  runKey: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()
const LegacyEvent = AnalyticsEvent.extend({
  name: z.enum(['app_session_started', 'onboarding_step', 'provider_check_finished', 'remote_action_finished',
    'workspace_ready', 'account_session_ready', 'run_started', 'run_finished', 'result_presented', 'result_action']),
  properties: LegacyProps.default({})
}).strict()
const LegacyState = z.object({
  version: z.literal(1), enabled: z.boolean(), installation: z.enum(['existing', 'fresh', 'unknown']),
  installationId: z.string().uuid().nullable(), epoch: z.string().uuid(), actor: z.string().nullable(),
  pendingRuntimeClear: z.string().uuid().nullable().default(null), events: z.array(LegacyEvent).max(1000)
}).strict()
let directory: string, path: string, workPath: string
let storage: ReturnType<typeof analyticsStorage>
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kun-work-storage-'))
  path = join(directory, 'state.v1.json'); workPath = path + '.work-v1.json'; storage = analyticsStorage(path)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
function event(mode: 'code' | 'room' | 'work', occurredAt = new Date().toISOString()): AnalyticsEvent {
  return { eventId: randomUUID(), occurredAt, schemaVersion: 1, surface: 'desktop', observation: 'ui',
    sessionId: randomUUID(), appVersion: '0.4.1', platform: 'macos',
    name: mode === 'work' ? 'work_task_submitted' : 'result_action',
    properties: mode === 'work' ? { mode, runKey: 'a'.repeat(64) } : { mode, action: 'copy' } }
}
function state(events = [event('code'), event('work')]): AnalyticsDiskState {
  return { ...emptyAnalyticsState(), enabled: true, installation: 'existing', actor: 'u:' + randomUUID(),
    installationId: randomUUID(), events }
}
const disk = async () => JSON.parse(await readFile(path, 'utf8'))

describe('Work sidecar preserves legacy analytics storage and consent', () => {
  it('is readable by the frozen old parser and round-trips Work through an independent private sidecar', async () => {
    const input = state([event('code'), event('room'), event('work')])
    await storage.write(input)
    const old = LegacyState.parse(await disk())
    expect(old).toEqual({ ...input, events: input.events.slice(0, 2) })
    expect(old.enabled).toBe(true); expect(old.installation).toBe('existing')
    expect((await storage.read()).events).toEqual(input.events)
    const sidecar = JSON.parse(await readFile(workPath, 'utf8'))
    expect(sidecar).toMatchObject({ version: 1, epoch: input.epoch, actor: input.actor, events: [input.events[2]] })
    if (process.platform !== 'win32') expect((await stat(workPath)).mode & 0o777).toBe(0o600)
  })

  it('old-client withdrawal, actor change or epoch change never restores another identity\'s Work queue', async () => {
    const input = state(); await storage.write(input)
    const original = LegacyState.parse(await disk())
    for (const changed of [
      { ...original, enabled: false },
      { ...original, epoch: randomUUID() },
      { ...original, actor: 'u:' + randomUUID() },
      { ...original, installationId: randomUUID() }
    ]) {
      await writeFile(path, JSON.stringify(changed)) // Simulate the pre-Work client writing its own state.
      const restored = await storage.read()
      expect(restored.enabled).toBe(changed.enabled); expect(restored.epoch).toBe(changed.epoch)
      expect(restored.events).toEqual(original.events)
    }
  })

  it('corrupt, oversized or malformed sidecars cannot disable or drop a valid legacy queue', async () => {
    const input = state(); await storage.write(input)
    for (const raw of ['{broken', 'x'.repeat(ANALYTICS_LIMITS.bytes + 1), JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, epoch: input.epoch, actor: input.actor, installationId: input.installationId,
        events: [{ ...input.events[1], properties: { mode: 'work', prompt: 'private' } }] })]) {
      await writeFile(workPath, raw)
      const restored = await storage.read()
      expect(restored.enabled).toBe(true); expect(restored.actor).toBe(input.actor)
      expect(restored.events).toEqual([input.events[0]])
    }
  })

  it('cannot recover consent or Work from an orphan sidecar after missing or corrupt main state', async () => {
    await storage.write(state())
    await rm(path)
    expect(await storage.read()).toMatchObject({ enabled: false, events: [] })
    await writeFile(path, '{broken')
    expect(await storage.read()).toMatchObject({ enabled: false, events: [] })
  })

  it('commits the new identity first so a failed sidecar replacement cannot restore old Work', async () => {
    const old = state(); await storage.write(old)
    const stale = await readFile(workPath, 'utf8')
    await rm(workPath); await mkdir(workPath) // Force rename to fail after committing main state.
    const next = state()
    await expect(storage.write(next)).rejects.toThrow()
    expect(LegacyState.parse(await disk()).actor).toBe(next.actor)
    await rm(workPath, { recursive: true }); await writeFile(workPath, stale)
    expect((await storage.read()).events).toEqual([next.events[0]])
  })

  it('removes Work on withdrawal or acknowledgement while keeping the old main shape', async () => {
    const input = state(); await storage.write(input)
    await storage.write({ ...input, events: [input.events[0]] })
    await expect(readFile(workPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await storage.write(input)
    await storage.write({ ...input, enabled: false, epoch: randomUUID(), events: [] })
    await expect(readFile(workPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(LegacyState.parse(await disk())).toMatchObject({ enabled: false, events: [] })
  })

  it('bounds the combined queue to 1000 events and drops expired entries in both files', async () => {
    const expired = new Date(Date.now() - ANALYTICS_LIMITS.ageMs - 1000).toISOString()
    const input = state([event('code', expired), event('work', expired),
      ...Array.from({ length: 1002 }, (_, i) => event(i % 2 ? 'work' : 'code', new Date(Date.now() - 1002 + i).toISOString()))])
    await storage.write(input)
    const restored = await storage.read()
    expect(restored.events).toHaveLength(1000)
    expect(restored.events.some(e => e.occurredAt === expired)).toBe(false)
    expect(LegacyState.parse(await disk()).events.length).toBe(500)
    const bytes = (await stat(path)).size + (await stat(workPath)).size
    expect(bytes).toBeLessThanOrEqual(ANALYTICS_LIMITS.bytes)
  })

  it('rejects an oversized combined snapshot before changing either file', async () => {
    const input = state(); await storage.write(input)
    const original = await readFile(path, 'utf8'), sidecar = await readFile(workPath, 'utf8')
    await expect(storage.write({ ...input, actor: 'u:'.repeat(ANALYTICS_LIMITS.bytes / 2) })).rejects.toThrow('analytics_queue_limit')
    expect(await readFile(path, 'utf8')).toBe(original); expect(await readFile(workPath, 'utf8')).toBe(sidecar)
  })

  it('does not put new Work-only metadata or actions into old Code/Room event enums', async () => {
    const input = state([{ ...event('code'), properties: { mode: 'code', action: 'export' } },
      { ...event('room'), properties: { mode: 'room', feedbackKind: 'text' } }, event('code')])
    await storage.write(input)
    expect(LegacyState.parse(await disk()).events).toEqual([input.events[2]])
  })
})
