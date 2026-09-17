import { expect, it, vi } from 'vitest'
import { SanottsDownloadTasks } from './local-sanotts-download-tasks'
const pending = () => {
  let finish!: () => void
  const promise = new Promise<void>(resolve => { finish = resolve })
  return { finish, promise }
}
it('shares a transfer without allowing a playback owner to cancel a manual download', async () => {
  const tasks = new SanottsDownloadTasks()
  const deferred = pending()
  let signal!: AbortSignal
  const start = vi.fn(async (controller: AbortController) => { signal = controller.signal; await deferred.promise })
  const manual = tasks.run('runtime', undefined, start)
  const playback = tasks.run('runtime', 'answer-a', start)
  await Promise.resolve()
  tasks.release('answer-a')
  expect(signal.aborted).toBe(false)
  expect(start).toHaveBeenCalledTimes(1)
  deferred.finish()
  await Promise.all([manual, playback])
})
it('cancels owned voice downloads when the last listener leaves', async () => {
  const tasks = new SanottsDownloadTasks()
  const result = tasks.run('amy', 'answer-a', async controller => {
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve()))
    return controller.signal.aborted
  })
  await Promise.resolve()
  tasks.release('answer-a')
  expect(await result).toBe(true)
})
it('retains cancellation ownership while waiting for an aborted transfer to finish', async () => {
  const tasks = new SanottsDownloadTasks()
  const deferred = pending()
  const first = tasks.run('runtime', 'a', async () => deferred.promise)
  await Promise.resolve()
  tasks.release('a')
  const start = vi.fn(async () => 'should not run')
  const second = tasks.run('runtime', 'b', start).catch(error => error)
  tasks.release('b')
  deferred.finish()
  await first
  expect(await second).toBeInstanceOf(Error)
  expect(start).not.toHaveBeenCalled()
})
