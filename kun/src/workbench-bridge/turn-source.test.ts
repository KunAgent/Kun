import { afterEach, describe, expect, it } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { confirmWorkbenchLink } from './actions.js'
import { reconcileWorkbench } from './reconcile.js'
import { workbenchTurnSource } from './turn-source.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

const fixtures: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup() })

async function setup(policy: 'auto' | 'confirm', source: 'gui' | 'im') {
  const f = await workbenchFixture({ policy: { code: policy } }); fixtures.push(f)
  f.thread.turns[0].clientSurface = source
  await f.deps.threadStore.upsert(f.thread)
  const project = await f.makeDirectory('project')
  f.addCodeThread('project-source', project)
  const created = await f.run('create_code_task', { title: 'Review code', goal: 'Review the project', projectRoot: project })
  expect(created.isError).not.toBe(true)
  const id = (created.output as { linkId: string }).linkId
  const read = async () => (await f.store.get<WorkbenchLink>('workbench_link', id))!
  if (policy === 'confirm') await confirmWorkbenchLink(f.bridge, f.room.id, id, {
    clientRequestId: 'accept', expectedRevision: (await read()).revision })
  return { ...f, read }
}

describe('Workbench task source authority', () => {
  it.each(['auto', 'confirm'] as const)('preserves IM restrictions for %s even with a confirmedAt timestamp', async (policy) => {
    const f = await setup(policy, 'im')
    expect((await f.read()).value).toMatchObject({ origin: { clientSurface: 'im' }, confirmedAt: expect.any(String) })
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued[0].request).toMatchObject({ clientSurface: 'im', imContext: true })
  })

  it('keeps GUI tasks in their accepted source', async () => {
    const f = await setup('confirm', 'gui')
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued[0].request.clientSurface).toBe('gui')
    expect(f.stub.calls.enqueued[0].request.imContext).toBeUndefined()
  })

  it('recovers legacy provenance and never upgrades missing provenance', async () => {
    const f = await setup('auto', 'im')
    const link = (await f.read()).value
    if (link.origin.kind !== 'tool') throw new Error('expected tool origin')
    const legacy = { ...link, origin: { ...link.origin, clientSurface: undefined } }
    await expect(workbenchTurnSource(f.bridge, legacy)).resolves.toEqual({ clientSurface: 'im', imContext: true })
    await expect(workbenchTurnSource(f.bridge, { ...legacy, origin: { ...legacy.origin, runId: 'missing' } }))
      .resolves.toEqual({ clientSurface: 'im', imContext: true })
  })

  it('inherits series source and rejects a missing parent', async () => {
    const f = await setup('confirm', 'im')
    const parent = (await f.read()).value
    const child = { ...parent, id: 'occurrence', origin: { kind: 'series' as const, seriesId: parent.id, occurrence: 1 } }
    await expect(workbenchTurnSource(f.bridge, child)).resolves.toEqual({ clientSurface: 'im', imContext: true })
    await expect(workbenchTurnSource(f.bridge, { ...child, origin: { ...child.origin, seriesId: 'missing' } }))
      .rejects.toThrow('source is unavailable')
  })
})
