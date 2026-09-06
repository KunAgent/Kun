import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProviderMutationFlushRequestHandler } from '@shared/provider-mutation-barrier'
import { useProviderMutationFlushOperations } from '../components/provider-mutation-flush'
import {
  drainSharedProviderCredentialMutation,
  enqueueSharedModelMutation,
  resetSharedProviderMutationCoordinatorForTests,
  sharedProviderMutationCoordinator as coordinator,
  stageSharedProviderCredentialMutation
} from '../components/shared-provider-mutation-coordinator'
import {
  configureProviderMutationFlushOperations,
  installProviderMutationFlushHandler,
  resetProviderMutationFlushServiceForTests,
  type ProviderMutationFlushOperations
} from './provider-mutation-flush-service'

let handler: ProviderMutationFlushRequestHandler
let view: ReactTestRenderer | undefined
const request = { requestId: 'update-save', deadlineMs: 1000 }
const noopOperations: ProviderMutationFlushOperations = {
  drainProfile: async () => undefined,
  drainCatalog: async () => undefined,
  drainCredential: async () => undefined,
  drainDeletion: async () => undefined
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: { onProviderMutationFlushRequest: (value: ProviderMutationFlushRequestHandler) => {
    handler = value
    return () => undefined
  } } })
  installProviderMutationFlushHandler()
})

afterEach(async () => {
  if (view) await act(async () => view?.unmount())
  view = undefined
  resetProviderMutationFlushServiceForTests()
  resetSharedProviderMutationCoordinatorForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('allows update before the Provider settings page has ever opened when nothing is unsaved', async () => {
  await expect(handler(request)).resolves.toEqual({ requestId: request.requestId, ok: true,
    pendingProviderIds: [], mutationKinds: [] })
})

it('does not revoke data drainers when the Provider view unmounts', async () => {
  const commit = vi.fn(async () => undefined)
  const operations = { ...noopOperations, drainCredential: async (id: string, generation: number) => {
    await drainSharedProviderCredentialMutation(id, generation, commit)
  } }
  function ProviderView() { useProviderMutationFlushOperations(operations); return null }
  await act(async () => { view = create(createElement(ProviderView)) })
  stageSharedProviderCredentialMutation('provider-a', 'new-credential')
  await act(async () => { view?.unmount(); view = undefined })
  await expect(handler(request)).resolves.toMatchObject({ ok: true })
  expect(commit).toHaveBeenCalledOnce()
  expect(coordinator.pendingCredentials.size).toBe(0)
  await expect(handler(request)).resolves.toMatchObject({ ok: true })
})

it('reports all outstanding kinds when there is no save service instead of dropping pending edits', async () => {
  coordinator.pendingNames.set('name', { localName: 'new', canonicalName: 'new', committedRevision: null })
  coordinator.pendingCatalogs.set('catalog', { generation: 1, baseModels: [], baseModelProfiles: {},
    localModels: ['new'], localModelProfiles: {}, committedRevision: null })
  stageSharedProviderCredentialMutation('credential', 'secret')
  coordinator.pendingDeletions.set('deletion', { generation: 1, committedRevision: null })
  await expect(handler(request)).resolves.toEqual({ requestId: request.requestId, ok: false,
    pendingProviderIds: ['catalog', 'credential', 'deletion', 'name'],
    mutationKinds: ['catalog', 'credential', 'deletion', 'profile'], errorCode: 'flush-failed' })
  expect(coordinator.pendingNames.size + coordinator.pendingCatalogs.size +
    coordinator.pendingCredentials.size + coordinator.pendingDeletions.size).toBe(4)
})

it('drains name, catalog, credential and deletion changes through the application service', async () => {
  coordinator.pendingNames.set('name', { localName: 'new', canonicalName: 'new', committedRevision: null })
  coordinator.pendingCatalogs.set('catalog', { generation: 1, baseModels: [], baseModelProfiles: {},
    localModels: ['new'], localModelProfiles: {}, committedRevision: null })
  stageSharedProviderCredentialMutation('credential', 'secret')
  coordinator.pendingDeletions.set('deletion', { generation: 1, committedRevision: null })
  const calls: string[] = []
  configureProviderMutationFlushOperations({
    drainProfile: async id => { calls.push(id); coordinator.pendingNames.delete(id) },
    drainCatalog: async id => { calls.push(id); coordinator.pendingCatalogs.delete(id) },
    drainCredential: async id => { calls.push(id); coordinator.pendingCredentials.delete(id) },
    drainDeletion: async id => { calls.push(id); coordinator.pendingDeletions.delete(id) }
  })
  await expect(handler(request)).resolves.toMatchObject({ ok: true })
  expect(calls.sort()).toEqual(['catalog', 'credential', 'deletion', 'name'])
})

it('waits for queued saves even when the pending maps are empty', async () => {
  let release: (() => void) | undefined
  const queued = enqueueSharedModelMutation(() => new Promise<void>(resolve => { release = resolve }))
  const result = handler(request)
  let completed = false
  void result.then(() => { completed = true })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(completed).toBe(false)
  release?.()
  await queued
  await expect(result).resolves.toMatchObject({ ok: true })
})

it('does not swallow a failure in an already-running save queue', async () => {
  let fail: ((error: Error) => void) | undefined
  const queued = enqueueSharedModelMutation(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  void queued.catch(() => undefined)
  const result = handler(request)
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  fail?.(new Error('save rejected'))
  await expect(result).resolves.toMatchObject({ ok: false, errorCode: 'flush-failed' })
})

it('also waits for a follow-up save appended while the first queued save settles', async () => {
  let releaseFirst: (() => void) | undefined
  let releaseSecond: (() => void) | undefined
  const first = enqueueSharedModelMutation(() => new Promise<void>(resolve => { releaseFirst = resolve }))
  const chain = first.then(() => enqueueSharedModelMutation(() => new Promise<void>(resolve => { releaseSecond = resolve })))
  const result = handler(request)
  let completed = false
  void result.then(() => { completed = true })
  await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
  releaseFirst?.()
  await vi.waitFor(() => expect(releaseSecond).toBeTypeOf('function'))
  expect(completed).toBe(false)
  releaseSecond?.()
  await chain
  await expect(result).resolves.toMatchObject({ ok: true })
})

it('preserves a failed credential mutation after its view closes', async () => {
  stageSharedProviderCredentialMutation('provider-a', 'keep-this-edit')
  configureProviderMutationFlushOperations({ ...noopOperations, drainCredential: async () => {
    throw new Error('server rejected save')
  } })
  await expect(handler(request)).resolves.toMatchObject({ ok: false, errorCode: 'flush-failed',
    pendingProviderIds: ['provider-a'] })
  expect(coordinator.pendingCredentials.get('provider-a')?.credential).toBe('keep-this-edit')
})

it('times out a still-running queue without reporting an empty-map success', async () => {
  vi.useFakeTimers()
  let release: (() => void) | undefined
  const queued = enqueueSharedModelMutation(() => new Promise<void>(resolve => { release = resolve }))
  const result = handler({ ...request, deadlineMs: 20 })
  await vi.advanceTimersByTimeAsync(20)
  await expect(result).resolves.toMatchObject({ ok: false, errorCode: 'timeout' })
  release?.()
  await queued
})
