import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ manager: undefined as any, processes: [] as any[], stopViewers: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ app: {getPath: () => '/fixture', getAppPath: () => '/app'}, net: {fetch: vi.fn()} }))
vi.mock('../logger', () => ({logWarn: vi.fn()}))
vi.mock('../computer-access/lifecycle', () => ({stopComputerSessions: h.stopViewers}))
vi.mock('./viewer-resources', () => ({controlViewerEntry: () => '/download/viewer/index.html', probeControlViewer: vi.fn(async () => {})}))
vi.mock('./process', () => ({startControlProcess: vi.fn(async (_directory, release) => {
  const process = {exited: false, rpc: {closed: false, call: vi.fn(async (method: string, value?: any): Promise<any> => {
    if (method === 'desktop.command') {
      if (value.method === 'capabilities') return []
      return {supported: true, enabled: value.method === 'configureRemoteAccess' && value.value === true, ready: false, displays: []}
    }
    return {releaseId: release.releaseId}
  })},
    async stop() {process.exited = true; process.rpc.closed = true} }
  h.processes.push(process); return process
})}))
vi.mock('@kun/control-host', () => ({ControlPackageManager: class {
  state = {phase: 'starting'}
  initialize = vi.fn(async () => (this.state = {phase: 'not_installed'}))
  status = () => this.state
  check = vi.fn(async () => this.state)
  apply = vi.fn(async () => this.state)
  recover = vi.fn(async () => this.state)
  install = vi.fn(async () => {
    const release = {releaseId: 'downloaded-package'}
    this.state = {phase: 'verifying'}
    await this.options.driver.probe('/download', release)
    expect(await this.options.driver.drain()).toBe(true)
    this.state = {phase: 'activating'}
    await this.options.driver.activate('/download', release)
    await this.options.driver.resume()
    return this.state = {phase: 'ready'}
  })
  shutdown = async () => {await this.options.driver.stop()}
  constructor(readonly options: any) {h.manager = this}
}}))
import { ControlRuntimeHost } from './runtime-host'
import { resumeControlAdmission } from './admission'
let host: ControlRuntimeHost | undefined
afterEach(async () => {await host?.shutdown(); host = undefined; h.processes.length = 0; vi.clearAllMocks(); vi.useRealTimers(); resumeControlAdmission()})
it('starts without a baseline and does not download for status, disabled desktop or check operations', async () => {
  vi.useFakeTimers(); host = new ControlRuntimeHost()
  expect(h.manager.options.baseline).toBeUndefined()
  expect(await host.available()).toBeUndefined()
  const desktop = host.desktop({supported: () => true, displays: () => [], arbiter: {release: async () => {}}, indicator: {hide() {}}} as any)
  expect((await desktop.status()).enabled).toBe(false)
  await desktop.configureRemoteAccess(false)
  await host.packageOperation('check')
  await vi.advanceTimersByTimeAsync(24 * 3600000)
  expect(h.manager.install).not.toHaveBeenCalled()
  expect(h.processes).toHaveLength(0)
})
it('first-use download leaves waiting viewer opens intact and deduplicates concurrent demands', async () => {
  vi.useFakeTimers(); host = new ControlRuntimeHost()
  const a = host.ready(), b = host.ready()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await host.available()).toBeUndefined() // Activation health and engine attach are still running.
  await vi.advanceTimersByTimeAsync(30000)
  expect(await a).toBe(await b)
  expect(h.manager.install).toHaveBeenCalledTimes(1)
  expect(h.stopViewers).not.toHaveBeenCalled()
  expect(h.processes).toHaveLength(2) // Isolated probe and activated runtime.
  await host.ready()
  expect(h.manager.install).toHaveBeenCalledTimes(1)
})
it('preserves pending desktop enable and relay start across first-install drains', async () => {
  vi.useFakeTimers(); host = new ControlRuntimeHost()
  const desktop = host.desktop({supported: () => true, displays: () => [], arbiter: {release: async () => {}}, indicator: {hide() {}}} as any)
  const relay = host.relay({ticket: vi.fn(), renew: vi.fn(), socket: vi.fn(), state: vi.fn()} as any)
  const enabled = desktop.configureRemoteAccess(true)
  relay.start()
  await vi.advanceTimersByTimeAsync(31000)
  expect((await enabled).enabled).toBe(true)
  expect(desktop.capabilities().length).toBeGreaterThan(0)
  expect(h.manager.install).toHaveBeenCalledTimes(1)
  const calls = h.processes.at(-1).rpc.call.mock.calls
  expect(calls.filter(([method]: any[]) => method === 'relay.create')).toHaveLength(1)
  expect(calls.filter(([method, value]: any[]) => method === 'relay.command' && value.method === 'start')).toHaveLength(1)
  expect(calls.some(([method, value]: any[]) => method === 'desktop.command' && value.method === 'configureRemoteAccess' && value.value === true)).toBe(true)
  relay.stop()
})
