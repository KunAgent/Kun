// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ControlPackageCard } from './ControlPackageCard'
import type { ControlPackageStatus } from '@shared/control-package'
let root: Root, container: HTMLDivElement, status: ControlPackageStatus
const api = {status: vi.fn(), check: vi.fn(), install: vi.fn(), apply: vi.fn()}
beforeEach(() => {
  ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  status = {phase: 'not_installed'}
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  api.status.mockImplementation(async () => status)
  api.check.mockImplementation(async () => status)
  api.apply.mockImplementation(async () => status)
  api.install.mockImplementation(async () => {status = {phase: 'ready', version: '0.1.6'}; return status})
  vi.stubGlobal('kunGui', {mobileLink: {controlPackage: api}})
})
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks()})
const button = () => [...container.querySelectorAll('button')].find(value => value.textContent === 'Download package')!
it('offers first installation without needing an update candidate and never downloads on render', async () => {
  await act(async () => root.render(createElement(ControlPackageCard, {zh: false})))
  expect(container.textContent).toContain('Not installed')
  expect(button()).toBeTruthy()
  expect(api.install).not.toHaveBeenCalled()
  await act(async () => button().click())
  expect(api.install).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('0.1.6')
})
it('keeps download retry available after an offline first attempt without claiming rollback', async () => {
  api.install.mockRejectedValueOnce(Error('offline'))
  await act(async () => root.render(createElement(ControlPackageCard, {zh: false})))
  await act(async () => button().click())
  expect(container.textContent).toContain('Check your connection and retry')
  expect(container.textContent).not.toContain('Previous version restored')
  expect(button().disabled).toBe(false)
  await act(async () => button().click())
  expect(container.textContent).toContain('0.1.6')
})
it('explains a failed automatic first-use download and offers retry', async () => {
  status = {phase: 'not_installed', error: 'fetch failed'}
  await act(async () => root.render(createElement(ControlPackageCard, {zh: false})))
  expect(container.textContent).toContain('download or verification did not finish')
  expect(button().disabled).toBe(false)
  expect(api.install).not.toHaveBeenCalled()
})

const findButton = (label: string) => [...container.querySelectorAll('button')].find(value => value.textContent === label)
async function render(zh = false) { await act(async () => root.render(createElement(ControlPackageCard, { zh }))) }
async function click(label: string) {
  const target = findButton(label)
  expect(target).toBeTruthy()
  await act(async () => target!.click())
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it('keeps ready compact and reports a successful check inline without claiming an update', async () => {
  status = { phase: 'ready', version: '0.1.7' }
  const checking = deferred<ControlPackageStatus>()
  api.check.mockReturnValueOnce(checking.promise)
  await render()
  expect(container.querySelectorAll('button')).toHaveLength(1)
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Ready')
  await click('Check for updates')
  expect(findButton('Checking…')?.disabled).toBe(true)
  expect(api.install).not.toHaveBeenCalled()
  await act(async () => checking.resolve(status))
  expect(container.textContent).toContain('Up to date')
  expect(findButton('Done')).toBeUndefined()
})
it('shows one primary update action, both versions and the activation rules', async () => {
  status = { phase: 'available', version: '0.1.7', candidateVersion: '0.1.8' }
  await render()
  expect(container.textContent).toContain('v0.1.7')
  expect(container.textContent).toContain('v0.1.8')
  expect(container.querySelectorAll('button')).toHaveLength(1)
  expect(findButton('Download and update')).toBeTruthy()
  expect(container.querySelector('details')?.textContent).toContain('Active remote sessions and transfers finish before activation')
  expect(container.textContent).toContain('Accepted tasks keep running')
  expect(api.check).not.toHaveBeenCalled()
  expect(api.install).not.toHaveBeenCalled()
})
it('polls real download and verification phases, waits for idle and collapses only after Done', async () => {
  vi.useFakeTimers()
  status = { phase: 'available', version: '0.1.7', candidateVersion: '0.1.8' }
  const installation = deferred<ControlPackageStatus>()
  api.install.mockReturnValueOnce(installation.promise)
  await render(); await click('Download and update')
  expect(container.textContent).toContain('Downloading in the background')
  expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false)
  expect(findButton('Download and update')).toBeUndefined()
  status = { ...status, phase: 'verifying' }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('Verifying control package')
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Verify')
  status = { ...status, phase: 'waiting_for_idle' }
  await act(async () => installation.resolve(status))
  expect(container.textContent).toContain('Downloaded. Waiting for idle')
  expect(container.querySelector('[role="progressbar"]')).toBeNull()
  expect(findButton('Recheck idle state')?.disabled).toBe(false)
  expect(api.apply).not.toHaveBeenCalled()
  await click('Recheck idle state')
  expect(api.apply).toHaveBeenCalledOnce()
  expect(api.install).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Downloaded. Waiting for idle')
  status = { phase: 'activating', version: '0.1.7', candidateVersion: '0.1.8' }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('Activating update')
  expect(container.querySelectorAll('button')).toHaveLength(0)
  status = { phase: 'ready', version: '0.1.8' }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('v0.1.8 is active')
  expect(findButton('Done')).toBeTruthy()
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(findButton('Done')).toBeTruthy()
  await click('Done')
  expect(findButton('Done')).toBeUndefined()
  expect(findButton('Check for updates')).toBeTruthy()
  expect(container.textContent).toContain('v0.1.8')
})
it('ignores a stale status response after an explicit check finishes', async () => {
  vi.useFakeTimers()
  status = { phase: 'ready', version: '0.1.7' }
  await render()
  const stale = deferred<ControlPackageStatus>()
  api.status.mockReturnValueOnce(stale.promise)
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  api.check.mockResolvedValueOnce({ phase: 'available', version: '0.1.7', candidateVersion: '0.1.8' })
  await click('Check for updates')
  await act(async () => stale.resolve(status))
  expect(findButton('Download and update')).toBeTruthy()
  expect(container.textContent).toContain('v0.1.8')
})
it('does not mark checking or restoring as successful installation', async () => {
  vi.useFakeTimers()
  status = { phase: 'rolling_back', version: '0.1.7', error: 'CONTROL_ACTIVATION_FAILED' }
  await render()
  expect(container.textContent).toContain('Restoring previous version')
  expect(findButton('Done')).toBeUndefined()
  expect(container.querySelectorAll('button')).toHaveLength(0)
  expect(container.textContent).not.toContain('Ready to use')
  status = { ...status, phase: 'rolled_back' }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('Previous version restored')
  expect(container.textContent).toContain('Ready to use')
  expect(findButton('Check for updates again')).toBeTruthy()
  expect(findButton('Done')).toBeUndefined()
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('reports a failed rollback without claiming the previous version is usable', async () => {
  status = { phase: 'disabled', error: 'CONTROL_ROLLBACK_UNAVAILABLE' }
  await render()
  expect(container.textContent).toContain('A working version could not be restored')
  expect(container.textContent).not.toContain('Ready to use')
  expect(container.textContent).not.toContain('Previous version restored')
  expect(findButton('Check for updates again')?.disabled).toBe(false)
})
it('prioritizes the actual disk error over a generic operation failure', async () => {
  api.install.mockImplementationOnce(async () => {
    status = { phase: 'not_installed', error: 'CONTROL_DISK_SPACE_REQUIRED' }
    throw Error('CONTROL_DISK_SPACE_REQUIRED')
  })
  await render(); await click('Download package')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Free disk space')
  expect(findButton('Download package')?.disabled).toBe(false)
})
it('lets an initial status read failure recover instead of staying in preparation', async () => {
  api.status.mockRejectedValueOnce(Error('unavailable'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not read')
  expect(findButton('Check for updates again')?.disabled).toBe(false)
  status = { phase: 'ready', version: '0.1.7' }
  await click('Check for updates again')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.textContent).toContain('Up to date')
})
it('stops status polling on unmount and ignores a late install result', async () => {
  vi.useFakeTimers()
  const installation = deferred<ControlPackageStatus>()
  api.install.mockReturnValueOnce(installation.promise)
  await render(); await click('Download package')
  await act(async () => root.render(null))
  await act(async () => installation.resolve({ phase: 'ready', version: '0.1.8' }))
  await act(async () => vi.advanceTimersByTimeAsync(6000))
  expect(api.status).toHaveBeenCalledOnce()
  expect(container.textContent).toBe('')
})
it('keeps the update result when polling still returns the old ready version during install', async () => {
  vi.useFakeTimers()
  status = { phase: 'ready', version: '0.1.7', candidateVersion: '0.1.8', error: 'fetch failed' }
  const installation = deferred<ControlPackageStatus>()
  api.install.mockReturnValueOnce(installation.promise)
  await render(); await click('Download and update')
  status = { ...status, error: undefined }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  await act(async () => installation.resolve({ phase: 'ready', version: '0.1.8' }))
  expect(container.textContent).toContain('v0.1.8 is active')
  expect(findButton('Done')).toBeTruthy()
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('uses Chinese copy without exposing raw error codes or fictitious percentages', async () => {
  status = { phase: 'waiting_for_idle', version: '0.1.7', candidateVersion: '0.1.8' }
  await render(true)
  expect(container.textContent).toContain('已下载，等待空闲')
  expect(container.textContent).toContain('已提交的任务继续运行')
  expect(findButton('重新检查空闲状态')).toBeTruthy()
  expect(container.textContent).not.toMatch(/\d+%/)
})
