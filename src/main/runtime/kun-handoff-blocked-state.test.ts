import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_AUTOMATIC_HANDOFF_PROBES,
  clearHandoffBlockedState,
  handoffBlockedReachedCap,
  readHandoffBlockedState,
  recordHandoffBlocked
} from './kun-handoff-blocked-state'

describe('kun-handoff-blocked-state', () => {
  it('records, reads, caps, and clears blocked state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-handoff-blocked-'))
    const now = () => Date.parse('2026-08-21T00:00:00.000Z')
    let capped = false
    for (let i = 0; i < MAX_AUTOMATIC_HANDOFF_PROBES; i += 1) {
      const result = await recordHandoffBlocked({
        lastError: 'identity unreadable',
        ownerHints: [{ kind: 'runtime', pid: 901, port: 43001 }],
        reason: 'installed-build-change'
      }, dir, now)
      capped = result.capped
    }
    expect(capped).toBe(true)

    const state = await readHandoffBlockedState(dir)
    expect(state).toMatchObject({
      attempts: MAX_AUTOMATIC_HANDOFF_PROBES,
      reason: 'installed-build-change',
      ownerHints: [{ kind: 'runtime', pid: 901, port: 43001 }]
    })
    expect(handoffBlockedReachedCap(state)).toBe(true)

    const persisted = JSON.parse(
      await readFile(join(dir, 'kun-handoff-blocked.json'), 'utf8')
    ) as { attempts: number }
    expect(persisted.attempts).toBe(MAX_AUTOMATIC_HANDOFF_PROBES)

    await clearHandoffBlockedState(dir)
    expect(await readHandoffBlockedState(dir)).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  it('returns null when no blocked state exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-handoff-blocked-'))
    expect(await readHandoffBlockedState(dir)).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })
})
