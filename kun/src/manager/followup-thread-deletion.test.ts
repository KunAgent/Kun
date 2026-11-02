import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { managerFollowUpThreadDeletionGuard } from './followup-thread-deletion.js'
import { requestManagerJson } from './manager-client.js'
import { nativeManagerFixture, type NativeManagerFixture } from './followup-thread-test-support.js'

const fixtures: NativeManagerFixture[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

async function fixture(): Promise<NativeManagerFixture> {
  const result = await nativeManagerFixture()
  fixtures.push(result)
  return result
}

async function remove(h: NativeManagerFixture, threadId: string): Promise<unknown> {
  return requestManagerJson(h.connection, '/v1/data/thread/delete', {
    method: 'POST', body: { value: { threadId } }
  })
}

describe('physical Manager deletion of owned native targets', () => {
  it('does not delete an active owned target or its receipt history', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await expect(remove(h, h.thread.id)).rejects.toMatchObject({ status: 409 })
    const retained = await h.data.threadStore.get(h.thread.id)
    expect(retained?.nativeFollowUpRequests?.[0]?.admission.requestId).toBe(h.row.admission.requestId)
    expect(retained?.turns[0]?.status).toBe('queued')
  })

  it('retains an unsettled receipt even if its ownership link is no longer visible', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    vi.spyOn(h.data.roomStore, 'collaborationQuery').mockResolvedValue([])
    await expect(remove(h, h.thread.id)).rejects.toMatchObject({ status: 409 })
    expect((await h.data.threadStore.get(h.thread.id))?.nativeFollowUpRequests).toHaveLength(1)
  })

  it('refuses deletion when a terminal-looking receipt still has an active turn', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    vi.spyOn(h.data.roomStore, 'collaborationQuery').mockResolvedValue([])
    const read = h.data.threadStore.getMetadata!.bind(h.data.threadStore)
    vi.spyOn(h.data.threadStore, 'getMetadata').mockImplementation(async (threadId) => {
      const current = await read(threadId)
      if (!current || threadId !== h.thread.id) return current
      return { ...current, nativeFollowUpRequests: current.nativeFollowUpRequests?.map((row) =>
        ({ ...row, phase: 'admitted', terminalStatus: 'completed' })) }
    })
    await expect(remove(h, h.thread.id)).rejects.toMatchObject({ status: 409 })
    expect((await h.data.threadStore.get(h.thread.id))?.turns[0].status).toBe('queued')
  })

  it('serializes physical deletion with concurrent ownership writes', async () => {
    const h = await fixture(); await h.seed()
    const writes = new ManagerFollowUpWriteArbitration()
    const guard = managerFollowUpThreadDeletionGuard({ rooms: h.data.roomStore, writes })
    let enter!: () => void, finish!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const release = new Promise<void>((resolve) => { finish = resolve })
    const deletion = guard(h.data.threadStore, 'unowned-thread', async () => { enter(); await release; return true })
    await entered
    let ownershipWriteStarted = false
    const ownership = writes.run(async () => { ownershipWriteStarted = true })
    await Promise.resolve(); await Promise.resolve()
    expect(ownershipWriteStarted).toBe(false)
    finish()
    await expect(deletion).resolves.toBe(true)
    await ownership
    expect(ownershipWriteStarted).toBe(true)
  })

  it('preserves normal deletion of an unrelated unowned target', async () => {
    const h = await fixture(); await h.seed()
    const other = { ...h.thread, id: 'unowned-thread' }
    await h.data.executeThread('upsert', { thread: other })
    expect(await remove(h, other.id)).toEqual({ result: true })
    expect(await h.data.threadStore.get(other.id)).toBeNull()
    expect(await h.data.threadStore.get(h.thread.id)).not.toBeNull()
  })
})
