import { EventEmitter } from 'node:events'
import hostProcess from 'node:process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
vi.mock('node:child_process', () => mocks)
vi.mock('./native-input', () => ({ desktopHelperAvailable: () => true, desktopHelperPath: () => 'remote-desktop-input.exe' }))

class Helper extends EventEmitter {
  pid = 123
  stdin = new PassThrough()
  stdout = new PassThrough()
  exitCode: number | null = null
  signalCode: string | null = null
  writes: string[] = []
  constructor() {
    super()
    this.stdin.on('data', bytes => this.writes.push(bytes.toString()))
  }
  kill(signal = 'SIGTERM') {
    this.signalCode = signal
    queueMicrotask(() => this.emit('close', null, signal))
  }
  exit(code: number) {
    this.exitCode = code
    this.emit('close', code, null)
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('process', Object.create(hostProcess, { platform: { value: 'win32' } }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('advertises privacy only when the installed Windows helper supports capture exclusion', async () => {
  mocks.spawnSync.mockReturnValue({ status: 2, stdout: 'kun-privacy-screen-v1' })
  expect((await import('./privacy-screen')).privacyScreenSupported()).toBe(false)
  vi.resetModules()
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: 'kun-privacy-screen-v1\r\n' })
  expect((await import('./privacy-screen')).privacyScreenSupported()).toBe(true)
})

it('keeps the original video track and waits for the Windows compositor acknowledgement', async () => {
  const { NativePrivacyScreen } = await import('./privacy-screen')
  const child = new Helper(), frame = vi.fn(), lost = vi.fn()
  mocks.spawn.mockReturnValue(child)
  const curtain = new NativePrivacyScreen(5, { pid: 45, birth: '2:5' }, false, frame, lost)
  const opening = curtain.open()
  expect(mocks.spawn).toHaveBeenCalledWith('remote-desktop-input.exe', ['--privacy-screen', '5', '45', '2:5', 'physical'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  child.stdout.write('ready 0 0\r\n')
  await expect(opening).resolves.toEqual({ width: 0, height: 0 })
  expect(curtain.replacesVideo).toBe(false)

  const showing = curtain.show()
  expect(curtain.visible).toBe(false)
  child.stdout.write('shown\r\n')
  await showing
  expect(curtain.visible).toBe(true)
  curtain.lease(9000)
  curtain.requestFrame()
  expect(child.writes).toEqual(['show\n', 'lease 6000\n'])
  expect(frame).not.toHaveBeenCalled()
  child.exit(5)
  expect(curtain.visible).toBe(false)
  expect(lost).toHaveBeenCalledWith(true)
  await curtain.stop()
})

it('cannot activate a curtain after disconnect during the Windows handshake', async () => {
  const { NativePrivacyScreen } = await import('./privacy-screen')
  const child = new Helper(), lost = vi.fn()
  mocks.spawn.mockReturnValue(child)
  const curtain = new NativePrivacyScreen(5, { pid: 45, birth: '2:5' }, false, vi.fn(), lost)
  const opening = curtain.open()
  child.stdout.write('ready 0 0\n')
  await opening
  const rejected = expect(curtain.show()).rejects.toThrow('DESKTOP_CAPTURE_CLOSED')
  await curtain.stop()
  await rejected
  child.stdout.write('shown\n')
  expect(curtain.visible).toBe(false)
  expect(lost).not.toHaveBeenCalled()
})
