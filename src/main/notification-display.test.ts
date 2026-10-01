import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { displayNotification } from './notification-display'

it('waits for the native display receipt and reports asynchronous failures', async () => {
  const emitter = new EventEmitter()
  const notification = Object.assign(emitter, { show: vi.fn() })
  const shown = displayNotification(notification as never)
  expect(notification.show).toHaveBeenCalledOnce()
  emitter.emit('show')
  expect(await shown).toEqual({ ok: true, shown: true })
  expect(emitter.listenerCount('failed')).toBe(0)
  const failed = displayNotification(notification as never)
  emitter.emit('failed', {}, 'desktop unavailable')
  expect(await failed).toEqual({ ok: false, message: 'desktop unavailable' })
})

it('leaves an unconfirmed notification retryable instead of claiming delivery', async () => {
  const notification = Object.assign(new EventEmitter(), { show: vi.fn() })
  expect(await displayNotification(notification as never, 1)).toMatchObject({ ok: false })
  expect(notification.listenerCount('show')).toBe(0)
})
