import { afterEach, expect, it, vi } from 'vitest'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { HostDirectory } from './host-directory'

afterEach(() => vi.useRealTimers())

it('backs off passive refreshes after failure, while manual refresh and account changes fetch immediately', async () => {
  vi.useFakeTimers({toFake:['performance','setTimeout','clearTimeout']})
  const directory = new HostDirectory()
  const state: MobileLinkStatus = {enabled:true, online:false, grants:[], pairings:[], error:'CONNECTION_UNAVAILABLE'}
  const load = vi.fn(async () => state)
  const view = (value: MobileLinkStatus) => value
  const read = (age = 10000, generation = 1) => directory.read(generation, 1, age, load, view)
  await read()
  await vi.advanceTimersByTimeAsync(5000)
  await read()
  expect(load).toHaveBeenCalledTimes(1)
  await read(0)
  await vi.advanceTimersByTimeAsync(15000)
  await read()
  expect(load).toHaveBeenCalledTimes(2)
  await read(10000, 2)
  expect(load).toHaveBeenCalledTimes(3)
})
