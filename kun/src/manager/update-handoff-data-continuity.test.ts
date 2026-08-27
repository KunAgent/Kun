import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { makeInterruptionNoteItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord, finishTurn } from '../domain/turn.js'
import {
  readForcedRuntimeRecovery,
  recordVerifiedForcedRuntimeOwner
} from './forced-runtime-recovery.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import {
  reconcileVerifiedForcedRuntimeRecovery,
  ServiceManagerState
} from './service-manager.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function registration(flavor: 'production' | 'development', instanceId: string) {
  return {
    flavor,
    instanceId,
    pid: flavor === 'production' ? 4101 : 4102,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: flavor === 'production' ? 18899 : 18999,
    baseUrl: `http://127.0.0.1:${flavor === 'production' ? 18899 : 18999}`,
    runtimeToken: `${flavor}-token`
  }
}

describe('update handoff data continuity', () => {
  it('keeps committed settings, history, checkpoints, and attachments readable after forced recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-update-handoff-data-'))
    roots.push(root)
    const controlDir = join(root, 'control')
    const dataDir = join(root, 'data')
    const settingsPath = join(root, 'kun-settings.json')
    const settingsText = '{"version":1,"theme":"dark","sentinel":"keep-me"}\n'
    await writeFile(settingsPath, settingsText, 'utf8')

    const threadId = 'thread-update-continuity'
    const committed = finishTurn(createTurnRecord({
      id: 'turn-committed',
      threadId,
      prompt: 'Keep committed work.',
      status: 'running',
      createdAt: '2026-08-21T00:00:00.000Z'
    }), 'completed', '2026-08-21T00:00:01.000Z')
    const active = createTurnRecord({
      id: 'turn-forced',
      threadId,
      prompt: 'Resume after update.',
      status: 'running',
      createdAt: '2026-08-21T00:00:02.000Z'
    })
    const thread = {
      ...createThreadRecord({
        id: threadId,
        title: 'Update continuity',
        workspace: '/tmp/workspace',
        model: 'test-model'
      }),
      status: 'running' as const,
      turns: [committed, active]
    }
    let store = await ManagerSharedDataStore.create(dataDir)
    await store.executeThread('upsert', { thread })
    await store.executeSession('appendItem', {
      threadId,
      item: makeInterruptionNoteItem({
        id: 'checkpoint-before-update',
        threadId,
        turnId: committed.id,
        sourceTurnId: committed.id,
        text: 'Committed checkpoint before update.',
        createdAt: '2026-08-21T00:00:01.000Z'
      })
    })
    await store.executeSession('appendEvent', {
      threadId,
      event: {
        kind: 'heartbeat',
        threadId,
        seq: 1,
        timestamp: '2026-08-21T00:00:01.000Z'
      }
    })
    const attachment = await store.executeAttachment('create', {
      config: DEFAULT_KUN_CAPABILITIES_CONFIG.attachments,
      value: {
        name: 'continuity.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('attachment survives update').toString('base64'),
        documentText: 'attachment survives update',
        threadId
      }
    }) as { id: string }
    await store.close()

    const state = new ServiceManagerState()
    const oldOwner = registration('production', 'production-forced')
    state.register(oldOwner, new Date('2026-08-21T00:00:02.000Z'))
    state.acquireLease({
      threadId,
      turnId: active.id,
      ownerFlavor: oldOwner.flavor,
      ownerInstanceId: oldOwner.instanceId
    }, new Date('2026-08-21T00:00:02.000Z'))
    const marker = await recordVerifiedForcedRuntimeOwner({
      controlDir,
      dataDir,
      owner: {
        flavor: oldOwner.flavor,
        instanceId: oldOwner.instanceId,
        pid: oldOwner.pid,
        startedAt: oldOwner.startedAt
      }
    })

    store = await ManagerSharedDataStore.create(dataDir)
    let stateFlushed = false
    await expect(reconcileVerifiedForcedRuntimeRecovery({
      controlDir,
      dataDir,
      record: marker,
      state,
      sharedData: store,
      flushState: async () => { stateFlushed = true }
    })).resolves.toBe(1)
    expect(stateFlushed).toBe(true)
    expect(await readForcedRuntimeRecovery(controlDir)).toBeNull()
    await store.close()

    store = await ManagerSharedDataStore.create(dataDir)
    expect(await readFile(settingsPath, 'utf8')).toBe(settingsText)
    expect(await store.executeThread('get', { threadId })).toMatchObject({
      turns: [
        { id: committed.id, status: 'completed' },
        { id: active.id, status: 'failed' }
      ]
    })
    const items = await store.executeSession('loadItems', { threadId }) as Array<{
      id: string
      kind: string
      code?: string
    }>
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'checkpoint-before-update', kind: 'interruption_note' }),
      expect.objectContaining({ kind: 'error', code: 'owner_lease_expired' })
    ]))
    const events = await store.executeSession('loadEventsSince', {
      threadId,
      sinceSeq: 0
    }) as Array<{ kind: string; code?: string }>
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heartbeat' }),
      expect.objectContaining({ kind: 'turn_failed', code: 'owner_lease_expired' })
    ]))
    const resolved = await store.executeAttachment('resolveContent', {
      config: DEFAULT_KUN_CAPABILITIES_CONFIG.attachments,
      value: { id: attachment.id, scope: { threadId } }
    }) as { dataBase64: string }
    expect(Buffer.from(resolved.dataBase64, 'base64').toString())
      .toBe('attachment survives update')

    state.register(registration('production', 'production-current'))
    state.register(registration('development', 'development-current'))
    expect(state.snapshot().map((slot) => slot.registration.instanceId).sort()).toEqual([
      'development-current',
      'production-current'
    ])
    await store.close()
  })
})
