import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import {ParamSchemas } from '../contracts.js'
import { matchesUpdatedRange } from './search-filters.js'
import { KUN_VERSION } from '../../version.js'

describe('Code search project, Agent and UTC date combination', () => {
  it('combines all filters, includes the lower boundary and excludes the upper boundary', async () => {
    const f = await remoteFixture()
    try {
      const otherRoot = join(f.root, 'another-project'); await mkdir(otherRoot)
      async function row(title: string, updatedAt: string, harnessId = 'kun', workspace = f.root) {
        const thread = await f.h.threads.create({ workspace, title, model: 'fake', agentSurface: 'code', workspaceMode: 'code', mode: 'agent' })
        await f.h.threadStore.upsert({ ...thread, updatedAt, harnessId })
        return thread.id
      }
      const lower = await row('lower', '2026-01-02T00:00:00.000Z')
      const inside = await row('inside', '2026-01-02T12:00:00.000Z')
      await row('earlier', '2026-01-01T23:59:59.999Z')
      await row('upper', '2026-01-03T00:00:00.000Z')
      await row('other Agent', '2026-01-02T12:00:00.000Z', 'fixture-agent')
      await row('other project', '2026-01-02T12:00:00.000Z', 'kun', otherRoot)
      const search = { search: (params: unknown) => f.call('code.search', params) }
      const p = ParamSchemas['code.search'].parse({ status: 'idle', harnessId: 'kun',
        projectId: createHash('sha256').update(await realpath(f.root)).digest('hex'),
        updatedFrom: Date.parse('2026-01-02T00:00:00.000Z'), updatedBefore: Date.parse('2026-01-03T00:00:00.000Z') })
      expect((await f.h.threads.getMetadata(lower))!.updatedAt).toBe('2026-01-02T00:00:00.000Z')
      expect((await f.h.threads.getMetadata(lower))!.workspace).toBe(f.root)
      const result = await search.search(p)
      expect(result.threads.map((thread: { id: string }) => thread.id).sort()).toEqual([lower, inside].sort())
      expect(result.complete).toBe(true)
      expect(JSON.stringify(result)).not.toContain(f.root)
    } finally { await f.close() }
  })

  it('binds continuation to the full filter and advertises date support independently of old search', async () => {
    const f = await remoteFixture()
    try {
      await f.code('A'); await f.code('B')
      const search = { search: (params: unknown) => f.call('code.search', params) }
      const first = await search.search({ limit: 1, updatedFrom: 0 })
      expect(first.nextCursor).toBeDefined()
      await expect(search.search({ limit: 1, updatedFrom: 1, cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      const catalog = await f.call('catalog.get', {})
      expect(catalog.capabilityDescriptors.find((item: any) => item.operation === 'code.search').limits.dateRange).toBe(1)
      expect(catalog.capabilityDescriptors.find((item: any) => item.operation === 'agent.search')).toMatchObject({ resourceKind: 'agent', allowedActions: ['read'] })
      expect(catalog.host).toMatchObject({ runtimeVersion: KUN_VERSION, protocolVersion: 1 })
      expect(Number.isSafeInteger(catalog.host.confirmedAt)).toBe(true)
      expect(catalog.host).not.toHaveProperty('workspace')
    } finally { await f.close() }
  })

  it('rejects ambiguous, reversed and nonnumeric dates instead of accepting them silently', () => {
    for (const value of [{ updatedFrom: '2026-01-01' }, { updatedFrom: -1 }, { updatedFrom: 1.5 },
      { updatedBefore: Infinity }, { updatedBefore: 253402300800000 }, { updatedFrom: 20, updatedBefore: 10 },
      { updatedFrom: 10, updatedBefore: 10 }]) expect(() => ParamSchemas['code.search'].parse(value)).toThrow()
    expect(matchesUpdatedRange({ updatedAt: 'invalid' }, { updatedFrom: 0 })).toBe(false)
    expect(matchesUpdatedRange({ updatedAt: '2026-01-02T08:00:00+08:00' }, { updatedFrom: Date.parse('2026-01-02T00:00:00Z') })).toBe(true)
  })
})
