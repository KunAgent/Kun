import { expect, it, vi } from 'vitest'
import { DesktopPorts } from './desktop-ports'

async function fixture() {
  const stop = vi.fn(), callbacks = { lost: () => {}, end: () => {} }
  const authority = { current: () => true, scopes: ['desktop.view', 'desktop.control'] }
  const deps = {
    authorizeOrigin: async () => {},
    capture: () => ({ open: async () => {}, identity: async () => ({ pid: 42, birth: '1:2' }) }),
    input: (lost: () => void) => { callbacks.lost = lost; return { start: async () => {} } },
    indicator: { show: (_status: unknown, end: () => void) => { callbacks.end = end } }
  }
  const ports = new DesktopPorts('engine', deps as any, () => undefined, () => authority as any, () => true, stop)
  await ports.call({ operation: 'authorizeOrigin', authorityId: 'authority', origin: { kind: 'code', id: 'thread' } })
  return { ports, stop, callbacks }
}

it('reports a lost native input helper independently of the host stop button', async () => {
  const f = await fixture()
  await f.ports.call({ operation: 'capture.open', resourceId: '11111111-1111-4111-8111-111111111111', fields: { displayId: 1 } })
  await f.ports.call({ operation: 'input.start', resourceId: '22222222-2222-4222-8222-222222222222', args: [1, 42, '1:2'] })
  f.callbacks.lost()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('input_helper_lost')
})

it('reports an actual host stop button action as host_user_ended', async () => {
  const f = await fixture()
  await f.ports.call({ operation: 'indicator.show', value: { display: 'Display', mode: 'view' } })
  f.callbacks.end()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('host_user_ended')
})
