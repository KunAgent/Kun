import type { BrowserWindow } from 'electron'
import type {
  DesktopStartupPhase,
  DesktopStartupStatePayload
} from '../shared/desktop-startup-state'

type MainWindowState = Pick<BrowserWindow, 'isDestroyed'> & {
  webContents: Pick<BrowserWindow['webContents'], 'isDestroyed' | 'send'>
}

const NORMAL_TRANSITIONS: Record<DesktopStartupPhase, readonly DesktopStartupPhase[]> = {
  bootstrapping: [
    'shell_ready',
    'services_starting',
    'data_migrating',
    'runtime_handoff',
    'recovery_required'
  ],
  shell_ready: [
    'services_starting',
    'data_migrating',
    'manager_starting',
    'runtime_handoff',
    'recovery_required'
  ],
  services_starting: [
    'data_migrating',
    'manager_starting',
    'runtime_handoff',
    'ready',
    'recovery_required'
  ],
  data_migrating: [
    'manager_starting',
    'services_starting',
    'runtime_handoff',
    'ready',
    'recovery_required'
  ],
  manager_starting: ['runtime_handoff', 'runtime_starting', 'ready', 'recovery_required'],
  runtime_handoff: ['runtime_starting', 'ready', 'recovery_required'],
  runtime_starting: ['ready', 'recovery_required'],
  ready: [],
  recovery_required: []
}

/**
 * Finite startup lifecycle shared by Main, preload, and the renderer shell.
 * The window can appear as soon as `shell_ready`; runtime-dependent features
 * stay gated until `ready`.
 */
export class DesktopStartupState {
  private phaseValue: DesktopStartupPhase = 'bootstrapping'
  private detailValue: string | undefined

  constructor(private readonly getMainWindow: () => MainWindowState | null) {}

  get phase(): DesktopStartupPhase {
    return this.phaseValue
  }

  get detail(): string | undefined {
    return this.detailValue
  }

  isReady(): boolean {
    return this.phaseValue === 'ready'
  }

  isShellReady(): boolean {
    return this.phaseValue !== 'bootstrapping' && this.phaseValue !== 'recovery_required'
  }

  transition(next: DesktopStartupPhase, detail?: string): void {
    if (next === this.phaseValue && detail === undefined) return
    if (next !== this.phaseValue && !NORMAL_TRANSITIONS[this.phaseValue].includes(next)) {
      throw new Error(`Invalid desktop startup transition: ${this.phaseValue} -> ${next}`)
    }
    this.phaseValue = next
    if (detail === undefined) this.detailValue = undefined
    else this.detailValue = detail
    this.publish()
  }

  /** Update only the progress detail without changing phase. */
  noteDetail(detail: string): void {
    this.detailValue = detail
    this.publish()
  }

  assertReady(): void {
    if (this.isReady()) return
    throw new Error(`Kun desktop startup is not ready (phase: ${this.phaseValue}).`)
  }

  assertShellReady(): void {
    if (this.isShellReady()) return
    throw new Error(`Kun desktop startup shell is not ready (phase: ${this.phaseValue}).`)
  }

  payload(): DesktopStartupStatePayload {
    return this.detailValue === undefined
      ? { phase: this.phaseValue }
      : { phase: this.phaseValue, detail: this.detailValue }
  }

  publish(): void {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('startup:state', this.payload())
  }
}
