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
  api.install.mockImplementation(async () => {status = {phase: 'ready', version: '0.1.6'}; return status})
  vi.stubGlobal('kunGui', {mobileLink: {controlPackage: api}})
})
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks()})
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
