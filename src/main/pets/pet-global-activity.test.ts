import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { parsePetGlobalActivity, parsePetNativeActivity } from '../../shared/pets-global-activity'
import { PetGlobalActivity, PET_GLOBAL_SENDER_ID } from './pet-global-activity'
import { PetPresence } from './pet-presence'
import { PetStore } from './pet-store'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
function fixture(platform = 'darwin') {
  const children: Array<ReturnType<typeof child>> = []
  function child() {
    return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
      stderr: new PassThrough(), kill: vi.fn() })
  }
  const launch = vi.fn((_args: string[]) => { const process = child(); children.push(process); return process as unknown as ChildProcessWithoutNullStreams })
  const signal = vi.fn()
  const service = new PetGlobalActivity({ platform, executable: '/fixture/pet-activity', signal, launch })
  const send = (line: string): void => { children.at(-1)!.stdout.emit('data', Buffer.from(line)) }
  return { service, signal, launch, children, send }
}

describe('system pet activity observer', () => {
  it('starts only when opted in and visible; restored preferences never request permission', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.configure({ keyboard: true, microphone: true }, false)
    expect(f.launch).not.toHaveBeenCalled()
    f.service.configure({ keyboard: true, microphone: true }, true)
    expect(f.launch).toHaveBeenCalledExactlyOnceWith(['--keyboard', '--microphone'])
    f.service.configure({ keyboard: true, microphone: true }, true)
    expect(f.launch).toHaveBeenCalledOnce()
    f.send('{"type":"typing"}\n{"type":"recording","active":true}\n')
    expect(f.signal).toHaveBeenCalledWith({ type: 'input', source: 'global-microphone', kind: 'listening', level: 0 })
    f.service.configure({ keyboard: true, microphone: true }, false)
    expect(f.children[0].kill).toHaveBeenCalled()
    expect(f.service.status()).toEqual({ keyboard: 'paused', microphone: 'paused', recording: false })
    expect(f.signal).toHaveBeenLastCalledWith({ type: 'input', source: 'global-microphone', kind: 'idle', level: 0 })
    expect(vi.getTimerCount()).toBe(0)
    f.service.dispose()
  })

  it('parses split lines, ignores unrequested sources and clears activity on native failure', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.configure({ keyboard: false, microphone: true }, true)
    f.signal.mockClear()
    f.send('{"type":"record'); f.send('ing","active":true,"audio":"discard"}\n{"type":"typing"}\n')
    expect(f.signal).toHaveBeenCalledTimes(1)
    expect(f.service.status().recording).toBe(true)
    f.children[0].emit('exit', 1)
    expect(f.service.status().microphone).toBe('unavailable')
    expect(f.service.status().recording).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    f.send('{"type":"recording","active":true}\n')
    expect(f.service.status().recording).toBe(false)
    f.service.dispose()
  })

  it('bounds malformed native output and does not launch on unsupported platforms', () => {
    vi.useFakeTimers()
    const f = fixture(); f.service.configure({ keyboard: true, microphone: false }, true)
    f.send('x'.repeat(4097)); expect(f.children[0].kill).toHaveBeenCalled()
    expect(f.service.status().keyboard).toBe('unavailable'); f.service.dispose()
    const unsupported = fixture('win32')
    unsupported.service.configure({ keyboard: true, microphone: true }, true)
    expect(unsupported.service.status().microphone).toBe('unsupported')
    expect(unsupported.launch).not.toHaveBeenCalled(); unsupported.service.dispose()
  })

  it('requests keyboard permission only explicitly, coalesces requests and cleans up on shutdown', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.configure({ keyboard: true, microphone: false }, false)
    const first = f.service.requestKeyboardAccess(), second = f.service.requestKeyboardAccess()
    expect(f.launch).toHaveBeenCalledExactlyOnceWith(['--keyboard', '--request-keyboard', '--status'])
    f.service.dispose(); f.children[0].emit('exit', 0)
    await Promise.all([first, second])
    expect(f.launch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the in-app voice meter over a later coarse recording heartbeat', () => {
    vi.useFakeTimers()
    const presence = new PetPresence(() => undefined)
    presence.update(1, { type: 'input', source: 'voice', kind: 'listening', level: .7 })
    vi.advanceTimersByTime(500)
    presence.update(PET_GLOBAL_SENDER_ID, { type: 'input', source: 'global-microphone', kind: 'listening', level: 0 })
    expect(presence.snapshot().input?.level).toBe(.7)
    vi.advanceTimersByTime(1400)
    expect(presence.snapshot().input?.level).toBe(0)
    presence.dispose()
  })

  it('sanitizes preferences and persists opt-ins without activity history', async () => {
    expect(parsePetGlobalActivity({ keyboard: 'true', microphone: false })).toBeNull()
    expect(parsePetNativeActivity('{"type":"typing","key":"secret"}')).toEqual({ type: 'typing' })
    expect(parsePetNativeActivity('{"type":"recording","active":"true"}')).toBeNull()
    const root = await mkdtemp(path.join(tmpdir(), 'kun-pet-activity-')); roots.push(root)
    const store = new PetStore(root); await store.initialize()
    await store.setPetGlobalActivity({ keyboard: true, microphone: true })
    const restored = new PetStore(root); await restored.initialize()
    expect(restored.getSettings().globalActivity).toEqual({ keyboard: true, microphone: true })
    await writeFile(path.join(root, 'settings.json'), JSON.stringify({ globalActivity: { keyboard: 'yes', microphone: true } }))
    const invalid = new PetStore(root); await invalid.initialize()
    expect(invalid.getSettings().globalActivity).toEqual({ keyboard: false, microphone: false })
  })

  it('limits OS permission and preference IPC to the desktop main frame', async () => {
    const api = { getPetGlobalActivityStatus: vi.fn(), setPetGlobalActivity: vi.fn(), requestPetKeyboardAccess: vi.fn(),
      allows: (e: { isMainFrame: boolean; senderKind: string }, kinds: string[]) => e.isMainFrame && kinds.includes(e.senderKind) }
    const handlers = petIpcHandlers(api as unknown as PetIpcApi)
    const main = { senderId: 1, isMainFrame: true, senderKind: 'main' as const }
    for (const event of [{ ...main, senderKind: 'overlay' as const }, { ...main, isMainFrame: false }]) {
      await expect(handlers[PET_IPC.requestPetKeyboardAccess](event)).rejects.toThrow('desktop')
      await expect(handlers[PET_IPC.setPetGlobalActivity](event, { keyboard: true, microphone: true })).rejects.toThrow('desktop')
    }
    await expect(handlers[PET_IPC.setPetGlobalActivity](main, {})).rejects.toThrow('invalid')
    expect(api.requestPetKeyboardAccess).not.toHaveBeenCalled()
    await handlers[PET_IPC.setPetGlobalActivity](main, { keyboard: true, microphone: false, text: 'discard' })
    expect(api.setPetGlobalActivity).toHaveBeenCalledWith({ keyboard: true, microphone: false })
  })
})
