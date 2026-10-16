import { expect, it } from 'vitest'
import { ParamSchemas } from '../contracts.js'
import { REMOTE_METHOD_ORDER } from '../method-order.js'
import { remoteFixture } from '../testing/runtime.test-support.js'

it('binds every admitted wire operation to exactly one functional handler', async () => {
  const fixture = await remoteFixture()
  try {
    const registered = fixture.facade.operationMethods()
    expect(Object.keys(ParamSchemas)).toEqual(REMOTE_METHOD_ORDER)
    expect(new Set(registered).size).toBe(registered.length)
    expect([...registered].sort()).toEqual(Object.keys(ParamSchemas).sort())
    // These families use independent authorization, persistence, and recovery paths.
    for (const operation of ['agent.restart', 'agent.import.commit', 'code.fork', 'code.rewind.commit',
      'execution.queue.update', 'goal.update', 'file.preview', 'group.member.remove', 'plugin.setEnabled']) {
      expect(registered).toContain(operation)
    }
  } finally { await fixture.close() }
})
