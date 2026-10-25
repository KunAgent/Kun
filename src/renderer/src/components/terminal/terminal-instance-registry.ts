import '@xterm/xterm/css/xterm.css'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS } from '@shared/terminal'
import type { TerminalSettingsV1 } from '@shared/app-settings'
import { defaultTerminalSettings } from '@shared/app-settings-terminal'
import { getProvider } from '../../agent/registry'
import { loadHarnesses } from '../../store/harness-store'
import { useActivityStore } from '../../store/activity-store'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { requestDevPreviewUrl } from '../../lib/dev-preview-request'
import { isPtyTarget, terminalBackend, terminalTargetCreateExtras, type TerminalPtyTarget } from './terminal-backend'
import { fitVisibleTerminal, resizeTerminalSession } from './terminal-dimensions'
import { attachTerminalClipboardKeys, TERMINAL_FONT_FAMILY } from './terminal-panel-support'
import { readSessionStatus, updateSessionStatus, clearSessionStatus } from './terminal-dock-store'
import type { TerminalActivity, TerminalPane } from './terminal-dock-model'
import { readBufferLines, ShellCommandTracker, type ShellCommandRecord } from './terminal-shell-commands'
import { TerminalSearchController } from './terminal-search'
import { createFileLinkProvider, isLocalPreviewUrl } from './terminal-links'
import { loadTerminalSnapshot } from './terminal-restore'

/**
 * Live xterm instances, one per pane session, kept across tab switches and
 * dock collapse. A pane view only moves an instance's element into its
 * container; output keeps streaming while the element is detached, so status
 * dots stay current and switching back never replays or flickers.
 */
export type TerminalInstanceSpec = {
  ptySessionId: string
  pane: TerminalPane
  workspaceRoot: string
  /** Show saved output when the shell did not survive (Kun restarted). */
  restore?: boolean
}

export type TerminalRuntimeConfig = {
  settings: TerminalSettingsV1
  theme: ITheme
  searchColors: { match: string; active: string }
  restoredDivider: (savedAt: number) => string
  describeMark: (record: ShellCommandRecord) => string
}

type MarkListener = (record: ShellCommandRecord, anchor: DOMRect) => void
type SelectionListener = (text: string) => void

type TerminalInstance = {
  spec: TerminalInstanceSpec
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  commands: ShellCommandTracker | null
  search: TerminalSearchController
  disposers: Array<() => void>
  container: HTMLElement | null
  resizeObserver: ResizeObserver | null
  startToken: number
  visible: boolean
  lastOutputAt: number
  prefilled: boolean
  initialCommandSent: boolean
  runOnceTimer: ReturnType<typeof setTimeout> | null
  kunOutput: string
  markListeners: Set<MarkListener>
  selectionListeners: Set<SelectionListener>
}

const instances = new Map<string, TerminalInstance>()
let config: TerminalRuntimeConfig = {
  settings: defaultTerminalSettings(),
  theme: {},
  searchColors: { match: 'rgba(240,162,63,0.28)', active: 'rgba(240,162,63,0.62)' },
  restoredDivider: () => '──',
  describeMark: (record) => record.command
}

function fontFamily(settings: TerminalSettingsV1): string {
  const custom = settings.appearance.fontFamily.trim()
  return custom ? `${custom}, ${TERMINAL_FONT_FAMILY}` : TERMINAL_FONT_FAMILY
}

function terminalOptions(settings: TerminalSettingsV1) {
  return {
    fontFamily: fontFamily(settings),
    fontSize: settings.appearance.fontSize,
    lineHeight: settings.appearance.lineHeight,
    cursorStyle: settings.appearance.cursorStyle,
    cursorBlink: settings.appearance.cursorBlink,
    scrollback: settings.behavior.scrollback,
    macOptionIsMeta: settings.behavior.macOptionIsMeta
  } as const
}

/** Apply settings and theme to every live instance. */
export function configureTerminals(next: TerminalRuntimeConfig): void {
  config = next
  const options = terminalOptions(next.settings)
  for (const instance of instances.values()) {
    Object.assign(instance.term.options, options, { theme: next.theme })
    if (instance.visible) refit(instance)
  }
}

export function terminalRuntimeConfig(): TerminalRuntimeConfig {
  return config
}

function refit(instance: TerminalInstance): void {
  const dims = fitVisibleTerminal(instance.container, instance.fit, instance.term)
  if (!dims || !isPtyTarget(instance.spec.pane.target)) return
  const target = instance.spec.pane.target
  void resizeTerminalSession(terminalBackend(target).resize, instance.spec.ptySessionId, dims, () => undefined)
}

function setActivity(instance: TerminalInstance, activity: TerminalActivity, notable = false): void {
  const current = readSessionStatus(instance.spec.ptySessionId)
  if (current?.activity === activity && !(notable && !instance.visible && !current.unseen)) return
  updateSessionStatus(instance.spec.ptySessionId, {
    activity,
    ...(notable && !instance.visible ? { unseen: true } : {})
  })
}

function writeRestoredOutput(instance: TerminalInstance, from: string | undefined): void {
  if (!from) return
  const snapshot = loadTerminalSnapshot(from)
  if (!snapshot?.lines.length) return
  const body = snapshot.lines.map((line) => line.split(String.fromCharCode(27)).join('')).join('\r\n')
  instance.term.write(`\x1b[2m${body}\x1b[0m\r\n\x1b[2m${config.restoredDivider(snapshot.savedAt)}\x1b[0m\r\n`)
}

function runOnce(instance: TerminalInstance): void {
  const { pane, ptySessionId } = instance.spec
  if (!isPtyTarget(pane.target)) return
  const backend = terminalBackend(pane.target)
  if (pane.initialCommand && !instance.initialCommandSent) {
    instance.initialCommandSent = true
    void backend.write({ sessionId: ptySessionId, data: `${pane.initialCommand}\r` })
  } else if (pane.prefill && !instance.prefilled) {
    instance.prefilled = true
    void backend.write({ sessionId: ptySessionId, data: pane.prefill })
  }
}

function createInstance(spec: TerminalInstanceSpec): TerminalInstance {
  const settings = config.settings
  const host = document.createElement('div')
  host.className = 'kun-terminal-host'
  const term = new Terminal({
    ...terminalOptions(settings),
    allowProposedApi: true,
    theme: config.theme,
    cols: TERMINAL_DEFAULT_COLS,
    rows: TERMINAL_DEFAULT_ROWS,
    disableStdin: spec.pane.target.kind === 'kun-process'
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((event, uri) => {
    if (!event.metaKey && !event.ctrlKey && isLocalPreviewUrl(uri)) requestDevPreviewUrl(uri)
    else void window.kunGui.openExternal(uri)
  }))
  attachTerminalClipboardKeys(term)
  term.open(host)
  const instance: TerminalInstance = {
    spec, term, fit, host, commands: null,
    search: new TerminalSearchController(term, () => config.searchColors),
    disposers: [], container: null, resizeObserver: null, startToken: 0,
    visible: false, lastOutputAt: 0, prefilled: false, initialCommandSent: false, runOnceTimer: null, kunOutput: '',
    markListeners: new Set(), selectionListeners: new Set()
  }
  const { ptySessionId } = spec
  const links = term.registerLinkProvider(createFileLinkProvider(term, {
    resolveBase: () => readSessionStatus(ptySessionId)?.cwd ?? instance.spec.workspaceRoot,
    onOpen: (link, event) => {
      if (event.metaKey || event.ctrlKey) {
        void openWorkspacePathInEditor(link, instance.spec.workspaceRoot)
      } else {
        previewWorkspaceFile({ ...link, workspaceRoot: instance.spec.workspaceRoot })
      }
    }
  }))
  instance.disposers.push(() => links.dispose())
  if (spec.pane.target.kind === 'local') {
    instance.commands = new ShellCommandTracker(term, {
      describeMark: (record) => config.describeMark(record),
      onPrompt: () => {
        updateSessionStatus(ptySessionId, { integrated: true })
        runOnce(instance)
      },
      onCwd: (cwd) => updateSessionStatus(ptySessionId, { cwd }),
      onCommandStart: (record) => {
        updateSessionStatus(ptySessionId, { commandRunning: true, command: record.command, lastFailure: undefined })
        setActivity(instance, 'running')
      },
      onCommandFinish: (record) => {
        const failed = record.state === 'failed'
        updateSessionStatus(ptySessionId, {
          commandRunning: false,
          lastFailure: failed
            ? { recordId: record.id, command: record.command, exitCode: record.exitCode ?? 1, durationMs: (record.finishedAt ?? Date.now()) - record.startedAt }
            : undefined
        })
        setActivity(instance, 'done', true)
      },
      onMarkClick: (record, anchor) => {
        for (const listener of instance.markListeners) listener(record, anchor)
      }
    })
    instance.disposers.push(() => instance.commands?.dispose())
  }
  const bell = term.onBell(() => {
    if (!instance.visible) setActivity(instance, 'waiting', true)
  })
  const selection = term.onSelectionChange(() => {
    const text = term.getSelection()
    if (text && config.settings.behavior.copyOnSelect) void navigator.clipboard.writeText(text).catch(() => undefined)
    for (const listener of instance.selectionListeners) listener(text)
  })
  instance.disposers.push(() => bell.dispose(), () => selection.dispose())
  writeRestoredOutput(instance, spec.pane.restoredFrom)
  return instance
}

function wirePty(instance: TerminalInstance, target: TerminalPtyTarget): void {
  const { ptySessionId } = instance.spec
  const backend = terminalBackend(target)
  const offData = backend.onData((payload) => {
    if (payload.sessionId !== ptySessionId) return
    instance.term.write(payload.data)
    instance.lastOutputAt = Date.now()
    if (target.kind === 'agent' && !readSessionStatus(ptySessionId)?.unitId) setActivity(instance, 'running')
    const pending = (instance.spec.pane.prefill && !instance.prefilled) || (instance.spec.pane.initialCommand && !instance.initialCommandSent)
    if (pending && !readSessionStatus(ptySessionId)?.integrated) {
      // Shells without integration never announce a prompt; wait for output to settle.
      if (instance.runOnceTimer) clearTimeout(instance.runOnceTimer)
      instance.runOnceTimer = setTimeout(() => {
        instance.runOnceTimer = null
        if (!readSessionStatus(ptySessionId)?.integrated) runOnce(instance)
      }, 900)
    }
  })
  const offExit = backend.onExit((payload) => {
    if (payload.sessionId !== ptySessionId) return
    const failed = typeof payload.exitCode === 'number' && payload.exitCode !== 0
    updateSessionStatus(ptySessionId, {
      phase: 'exited', exitCode: payload.exitCode, commandRunning: false, activity: 'idle',
      ...(failed && !instance.visible ? { unseen: true } : {})
    })
    const probeHarnessId = instance.spec.pane.probeHarnessId
    if (probeHarnessId) {
      void Promise.resolve(getProvider().probeHarness?.(probeHarnessId)).finally(() => { void loadHarnesses(true) })
    }
  })
  const input = instance.term.onData((data) => {
    void backend.write({ sessionId: ptySessionId, data })
    if (readSessionStatus(ptySessionId)?.activity === 'waiting') setActivity(instance, target.kind === 'agent' ? 'running' : 'idle')
  })
  const resize = instance.term.onResize((dims) => {
    void resizeTerminalSession(backend.resize, ptySessionId, dims, () => undefined)
  })
  instance.disposers.push(offData, offExit, () => input.dispose(), () => resize.dispose())
}

function startCwd(target: TerminalPtyTarget, workspaceRoot: string): string | undefined {
  if (target.kind === 'local' && target.cwd) return target.cwd
  if (target.kind === 'agent' && target.cwd) return target.cwd
  return config.settings.behavior.startDirectory === 'home' && target.kind === 'local' ? undefined : workspaceRoot || undefined
}

async function startPty(instance: TerminalInstance): Promise<void> {
  const target = instance.spec.pane.target
  if (!isPtyTarget(target)) return
  const token = ++instance.startToken
  const { ptySessionId, workspaceRoot } = instance.spec
  const current = (): boolean => instances.get(ptySessionId) === instance && instance.startToken === token
  const backend = terminalBackend(target)
  const behavior = config.settings.behavior
  updateSessionStatus(ptySessionId, { phase: 'starting', error: undefined, exitCode: undefined })
  const extras = terminalTargetCreateExtras(target, workspaceRoot || undefined)
  const payload = {
    sessionId: ptySessionId,
    cols: instance.term.cols,
    rows: instance.term.rows,
    ...extras,
    ...(target.kind === 'local' ? { cwd: startCwd(target, workspaceRoot), shellIntegration: behavior.shellIntegration } : {}),
    ...(target.kind === 'local' && (target.shell || behavior.shell) ? { shell: target.shell || behavior.shell } : {})
  }
  try {
    let result = await backend.create(payload)
    if (!result.ok && 'reason' in result && result.reason === 'hostKeyConfirmationRequired') {
      if (window.confirm(`Trust SSH host key?\n\n${result.fingerprint}`)) {
        await window.kunGui.confirmRemoteSshHostKey(result)
        result = await backend.create(payload)
      }
    }
    if (!current()) return
    if (!result.ok) {
      updateSessionStatus(ptySessionId, { phase: 'error', error: 'message' in result ? result.message : 'SSH host key was not trusted.' })
      return
    }
    updateSessionStatus(ptySessionId, {
      phase: 'ready',
      ...('unitId' in result && result.unitId ? { unitId: result.unitId } : {})
    })
    if (instance.visible) refit(instance)
    if ('replayed' in result && result.replayed) {
      instance.prefilled = true
      instance.initialCommandSent = true
    }
  } catch (error) {
    if (current()) updateSessionStatus(ptySessionId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

/** Create (once) the instance for a pane and start its session. */
export function ensureTerminalInstance(spec: TerminalInstanceSpec): void {
  const existing = instances.get(spec.ptySessionId)
  if (existing) {
    existing.spec = spec
    return
  }
  const instance = createInstance(spec)
  instances.set(spec.ptySessionId, instance)
  if (!readSessionStatus(spec.ptySessionId)) updateSessionStatus(spec.ptySessionId, { phase: 'starting' })
  if (isPtyTarget(spec.pane.target)) {
    wirePty(instance, spec.pane.target)
    void (spec.restore ? restoreThenStart(instance) : startPty(instance))
  }
}

async function restoreThenStart(instance: TerminalInstance): Promise<void> {
  const { ptySessionId } = instance.spec
  const alive = await Promise.resolve(window.kunGui.getTerminalProcessInfo?.(ptySessionId)).catch(() => null)
  // A live PTY replays its own recent output when the pane re-attaches.
  if (!alive && instances.get(ptySessionId) === instance) writeRestoredOutput(instance, ptySessionId)
  await startPty(instance)
}

export function hasTerminalInstance(ptySessionId: string): boolean {
  return instances.has(ptySessionId)
}

/** Move the instance into `container`; returns the detach function. */
export function attachTerminal(ptySessionId: string, container: HTMLElement): () => void {
  const instance = instances.get(ptySessionId)
  if (!instance) return () => undefined
  instance.resizeObserver?.disconnect()
  container.appendChild(instance.host)
  instance.container = container
  let timer: ReturnType<typeof setTimeout> | null = null
  instance.resizeObserver = new ResizeObserver(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => refit(instance), 60)
  })
  instance.resizeObserver.observe(container)
  requestAnimationFrame(() => refit(instance))
  return () => {
    if (timer) clearTimeout(timer)
    if (instance.container !== container) return
    instance.resizeObserver?.disconnect()
    instance.resizeObserver = null
    instance.container = null
    if (instance.host.parentElement === container) container.removeChild(instance.host)
  }
}

/** A visible pane clears its "news" dot. */
export function setTerminalVisible(ptySessionId: string, visible: boolean): void {
  const instance = instances.get(ptySessionId)
  if (!instance || instance.visible === visible) return
  instance.visible = visible
  if (!visible) return
  const status = readSessionStatus(ptySessionId)
  if (status?.unseen) updateSessionStatus(ptySessionId, { unseen: false, ...(status.activity === 'done' ? { activity: 'idle' } : {}) })
  requestAnimationFrame(() => refit(instance))
}

export function focusTerminal(ptySessionId: string): void {
  instances.get(ptySessionId)?.term.focus()
}

export function terminalInstance(ptySessionId: string): { term: Terminal; commands: ShellCommandTracker | null; search: TerminalSearchController } | null {
  const instance = instances.get(ptySessionId)
  return instance ? { term: instance.term, commands: instance.commands, search: instance.search } : null
}

export function onTerminalMark(ptySessionId: string, listener: MarkListener): () => void {
  const instance = instances.get(ptySessionId)
  instance?.markListeners.add(listener)
  return () => { instance?.markListeners.delete(listener) }
}

export function onTerminalSelection(ptySessionId: string, listener: SelectionListener): () => void {
  const instance = instances.get(ptySessionId)
  instance?.selectionListeners.add(listener)
  return () => { instance?.selectionListeners.delete(listener) }
}

/** Send input to the session as if typed. */
export function writeToTerminal(ptySessionId: string, data: string): void {
  const instance = instances.get(ptySessionId)
  if (!instance || !isPtyTarget(instance.spec.pane.target)) return
  void terminalBackend(instance.spec.pane.target).write({ sessionId: ptySessionId, data })
}

export function pasteIntoTerminal(ptySessionId: string, text: string): void {
  instances.get(ptySessionId)?.term.paste(text)
}

export async function restartTerminal(ptySessionId: string): Promise<void> {
  const instance = instances.get(ptySessionId)
  if (!instance || !isPtyTarget(instance.spec.pane.target)) return
  try {
    await terminalBackend(instance.spec.pane.target).dispose(ptySessionId)
  } catch { /* Already gone. */ }
  instance.term.reset()
  updateSessionStatus(ptySessionId, { phase: 'starting', commandRunning: false, activity: 'idle', unseen: false, lastFailure: undefined, integrated: false })
  await startPty(instance)
}

export function clearTerminal(ptySessionId: string): void {
  instances.get(ptySessionId)?.term.clear()
}

/** Dispose the instance; `killPty` also ends the shell. */
export function disposeTerminal(ptySessionId: string, options: { killPty: boolean }): void {
  const instance = instances.get(ptySessionId)
  if (!instance) return
  instances.delete(ptySessionId)
  instance.startToken += 1
  if (instance.runOnceTimer) clearTimeout(instance.runOnceTimer)
  for (const dispose of instance.disposers.splice(0)) {
    try { dispose() } catch { /* Best effort. */ }
  }
  instance.resizeObserver?.disconnect()
  instance.host.remove()
  instance.term.dispose()
  if (options.killPty && isPtyTarget(instance.spec.pane.target)) {
    void terminalBackend(instance.spec.pane.target).dispose(ptySessionId).catch(() => undefined)
  }
  clearSessionStatus(ptySessionId)
}

/**
 * Feed a Kun background shell's output. Pipes carry bare `\n`; the delta is
 * appended when the output only grew, otherwise the view is redrawn.
 */
export function feedKunProcess(ptySessionId: string, output: string, running: boolean, exitCode: number | null): void {
  const instance = instances.get(ptySessionId)
  if (!instance) return
  const normalized = output.replace(/\r?\n/g, '\r\n')
  if (normalized !== instance.kunOutput) {
    if (normalized.startsWith(instance.kunOutput)) {
      instance.term.write(normalized.slice(instance.kunOutput.length))
    } else {
      instance.term.reset()
      instance.term.write(normalized)
    }
    instance.kunOutput = normalized
  }
  const previous = readSessionStatus(ptySessionId)
  if (running) {
    if (previous?.phase !== 'ready' || previous.activity !== 'running') updateSessionStatus(ptySessionId, { phase: 'ready', activity: 'running' })
  } else if (previous?.phase !== 'exited') {
    updateSessionStatus(ptySessionId, {
      phase: 'exited', exitCode, activity: exitCode === 0 ? 'done' : 'idle',
      ...(!instance.visible ? { unseen: true } : {})
    })
  }
}

/** Plain-text tail of one PTY instance; null for Kun processes or unknown ids. */
export function snapshotTerminal(ptySessionId: string, maxLines: number): string[] | null {
  const instance = instances.get(ptySessionId)
  if (!instance || !isPtyTarget(instance.spec.pane.target)) return null
  const buffer = instance.term.buffer.active
  return readBufferLines(instance.term, Math.max(0, buffer.length - maxLines * 2), buffer.length).slice(-maxLines)
}

/** Plain-text tail of every PTY instance, for restore after restart. */
export function collectTerminalSnapshots(maxLines: number): Record<string, string[]> {
  const snapshots: Record<string, string[]> = {}
  for (const id of instances.keys()) {
    const lines = snapshotTerminal(id, maxLines)
    if (lines) snapshots[id] = lines
  }
  return snapshots
}

/** Agent CLIs without an activity row go idle once their output stays quiet. */
const QUIET_AFTER_MS = 5_000
setInterval(() => {
  const now = Date.now()
  for (const instance of instances.values()) {
    if (instance.spec.pane.target.kind !== 'agent') continue
    const status = readSessionStatus(instance.spec.ptySessionId)
    if (status?.unitId || status?.activity !== 'running' || now - instance.lastOutputAt < QUIET_AFTER_MS) continue
    setActivity(instance, 'idle')
  }
}, 2_000)

/** Agent CLI panes follow their execution unit's activity row. */
useActivityStore.subscribe((state) => {
  for (const instance of instances.values()) {
    const unitId = readSessionStatus(instance.spec.ptySessionId)?.unitId
    const row = unitId ? state.rows[unitId] : undefined
    if (!row) continue
    if (row.state === 'waiting') setActivity(instance, 'waiting', true)
    else if (row.state === 'working' || row.state === 'initializing') setActivity(instance, 'running')
    else if (row.state === 'done' || row.state === 'failed') setActivity(instance, 'done', true)
  }
})
