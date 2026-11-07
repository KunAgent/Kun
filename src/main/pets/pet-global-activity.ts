import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PetPresenceSignal } from '../../shared/pets-interactions'
import { defaultPetGlobalActivity, parsePetNativeActivity, type PetGlobalActivityPreferences,
  type PetGlobalActivityStatus } from '../../shared/pets-global-activity'

export const PET_GLOBAL_SENDER_ID = -1

type Options = {
  platform: string
  executable: string
  signal: (signal: PetPresenceSignal) => void
  changed?: () => void
  launch?: (args: string[]) => ChildProcessWithoutNullStreams
}

/** Owns a state-only observer. No raw keyboard or microphone data crosses IPC. */
export class PetGlobalActivity {
  private child: ChildProcessWithoutNullStreams | null = null
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private preferences = defaultPetGlobalActivity()
  private enabled = false
  private state: PetGlobalActivityStatus = { keyboard: 'off', microphone: 'off', recording: false }
  private permission: Promise<void> | null = null
  private permissionChild: ChildProcessWithoutNullStreams | null = null
  private disposed = false

  constructor(private readonly options: Options) {}

  status(): PetGlobalActivityStatus { return { ...this.state } }

  configure(preferences: PetGlobalActivityPreferences, enabled: boolean): void {
    if (this.disposed) return
    if (this.enabled === enabled && this.preferences.keyboard === preferences.keyboard &&
        this.preferences.microphone === preferences.microphone) return
    this.stop()
    this.preferences = { ...preferences }
    this.enabled = enabled
    this.start()
  }

  async requestKeyboardAccess(): Promise<void> {
    if (this.disposed || this.options.platform !== 'darwin' || !this.preferences.keyboard) return
    if (this.permission) return this.permission
    this.permission = new Promise<void>((resolve) => {
      const child = this.launch(['--keyboard', '--request-keyboard', '--status'])
      this.permissionChild = child
      const finish = (): void => {
        clearTimeout(timeout)
        child.kill()
        if (this.permissionChild === child) this.permissionChild = null
        resolve()
      }
      const timeout = setTimeout(finish, 15_000)
      child.stdout.resume()
      child.stderr.resume()
      child.once('error', finish)
      child.once('exit', finish)
    }).finally(() => {
      this.permission = null
      if (!this.disposed) { this.stop(); this.start() }
    })
    return this.permission
  }

  dispose(): void { this.disposed = true; this.stop(); this.permissionChild?.kill() }

  private launch(args: string[]): ChildProcessWithoutNullStreams {
    return this.options.launch?.(args) ?? spawn(this.options.executable, args, { stdio: 'pipe', windowsHide: true })
  }

  private start(): void {
    const { keyboard, microphone } = this.preferences
    const state = this.options.platform !== 'darwin' ? 'unsupported' : !this.enabled ? 'paused' : 'starting'
    this.publish({ keyboard: keyboard ? state : 'off', microphone: microphone ? state : 'off', recording: false })
    if (state !== 'starting' || (!keyboard && !microphone)) return
    const child = this.launch([...(keyboard ? ['--keyboard'] : []), ...(microphone ? ['--microphone'] : [])])
    this.child = child
    let buffer = ''
    const failure = (): void => {
      if (this.child !== child) return
      this.stop()
      this.publish({ keyboard: keyboard ? 'unavailable' : 'off', microphone: microphone ? 'unavailable' : 'off', recording: false })
    }
    child.once('error', failure)
    child.once('exit', failure)
    child.stdin.on('error', failure)
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      buffer += chunk.toString('utf8')
      if (buffer.length > 4096) { failure(); return }
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const event = parsePetNativeActivity(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        if (!event) continue
        if (event.type === 'status') {
          this.publish({ ...this.state, keyboard: keyboard ? event.keyboard : 'off', microphone: microphone ? event.microphone : 'off' })
        } else if (event.type === 'typing' && keyboard) {
          this.options.signal({ type: 'input', source: 'global-keyboard', kind: 'typing', level: .5 })
        } else if (event.type === 'recording' && microphone) {
          if (event.active || this.state.recording) {
            this.options.signal({ type: 'input', source: 'global-microphone', kind: event.active ? 'listening' : 'idle', level: 0 })
          }
          this.publish({ ...this.state, recording: event.active })
        }
      }
    })
    child.stdin.write('alive\n')
    this.heartbeat = setInterval(() => { if (!child.stdin.destroyed) child.stdin.write('alive\n') }, 3000)
    this.heartbeat.unref?.()
  }

  private stop(): void {
    clearInterval(this.heartbeat)
    this.heartbeat = undefined
    const child = this.child
    this.child = null
    child?.stdin.end()
    child?.kill()
    for (const source of ['global-keyboard', 'global-microphone']) {
      this.options.signal({ type: 'input', source, kind: 'idle', level: 0 })
    }
  }

  private publish(status: PetGlobalActivityStatus): void {
    if (JSON.stringify(this.state) === JSON.stringify(status)) return
    this.state = status
    this.options.changed?.()
  }
}
