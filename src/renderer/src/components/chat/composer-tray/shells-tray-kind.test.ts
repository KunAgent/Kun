// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { resetDismissedBackgroundShells } from './shells-tray-poller'
import { useShellsTrayKind } from './shells-tray-kind'

const attach = vi.hoisted(() => ({ calls: [] as unknown[], result: true }))

vi.mock('../../../lib/terminal-output-attachment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/terminal-output-attachment')>()),
  attachTerminalOutput: async (input: unknown) => {
    attach.calls.push(input)
    return attach.result
  }
}))

type RuntimeRequestResult = { ok: boolean; status: number; body: string }
type Session = Record<string, unknown>

function shell(id: string, threadId: string, command: string, overrides: Session = {}): Session {
  return {
    id,
    threadId,
    turnId: `turn-${threadId}`,
    command,
    cwd: '/Users/me/code/kun',
    shell: 'zsh',
    status: 'running',
    startedAt: new Date(Date.now() - 192_400).toISOString(),
    exitCode: null,
    output: '',
    detached: true,
    ...overrides
  }
}

/** Finished just now, i.e. during this app session. */
function settled(id: string, command: string, exitCode: number, overrides: Session = {}): Session {
  return shell(id, 'thread-a', command, {
    status: 'completed', exitCode, finishedAt: new Date().toISOString(), ...overrides
  })
}

function response(sessions: Session[]): RuntimeRequestResult {
  return { ok: true, status: 200, body: JSON.stringify({ sessions, running: sessions.length }) }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const renders = { count: 0 }

function Host({ context }: { context: FloatingComposerRenderContext }): ReactElement {
  renders.count += 1
  const kind = useShellsTrayKind(context)
  return createElement(ComposerActivityTray, { kinds: [kind], compact: context.compact === true })
}

function context(overrides: Record<string, unknown> = {}): FloatingComposerRenderContext {
  return { activeThreadId: 'thread-a', runtimeReady: true, route: 'chat', compact: false, side: false, ...overrides }
}

describe('useShellsTrayKind', () => {
  let host: HTMLDivElement
  let root: Root
  let runtimeRequest: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    resetDismissedBackgroundShells()
    attach.calls = []
    attach.result = true
    renders.count = 0
    runtimeRequest = vi.fn(async () => response([]))
    Object.assign(window, { kunGui: { runtimeRequest, homeDir: '/Users/me' } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const settle = async (): Promise<void> => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
  const render = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => root.render(createElement(Host, { context: context(overrides) })))
    await settle()
  }
  const segment = (): HTMLButtonElement | null => host.querySelector('[data-tray-kind="shells"]')
  const openSheet = async (): Promise<void> => {
    await act(async () => segment()!.click())
  }
  const buttonByText = (text: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)

  it('polls only the active thread and shows its one live command', async () => {
    runtimeRequest.mockImplementation(async () => response([
      shell('shell-a', 'thread-a', 'npm run dev'),
      shell('shell-b', 'thread-b', 'npm run other')
    ]))
    await render()
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/background-shells?thread_id=thread-a')
    const slot = host.querySelector('[data-composer-stack-item="background-shell"]')
    expect(slot).not.toBeNull()
    expect(segment()!.textContent).toContain('npm run dev')
    expect(segment()!.getAttribute('aria-label')).toBe('Background commands: npm run dev')
    expect(host.textContent).not.toContain('npm run other')
  })

  it('stays hidden without a ready runtime or a thread, and when nothing runs or failed', async () => {
    await render({ runtimeReady: false })
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
    await render({ activeThreadId: null })
    expect(runtimeRequest).not.toHaveBeenCalled()
    runtimeRequest.mockImplementation(async () => response([settled('ok', 'npm run lint', 0)]))
    await render()
    expect(runtimeRequest).toHaveBeenCalled()
    expect(segment()).toBeNull()
  })

  it('keeps an undismissed failure visible until it is dismissed', async () => {
    runtimeRequest.mockImplementation(async () => response([
      settled('fail', 'npx vitest --watch src/auth', 1, { output: "Error: Cannot find module './token-cache'" }),
      shell('old-fail', 'thread-a', 'from an earlier app run', {
        status: 'failed', exitCode: 1, startedAt: '2020-01-01T00:00:00.000Z', finishedAt: '2020-01-01T00:00:01.000Z'
      })
    ]))
    await render()
    expect(segment()!.textContent).toContain('1 background command')
    expect(segment()!.getAttribute('data-tone')).toBe('error')
    await openSheet()
    const sheet = host.querySelector('[data-tray-sheet="shells"]')!
    expect(sheet.textContent).toContain('1 failed')
    expect(sheet.textContent).toContain("Exit code 1 · just now · Cannot find module './token-cache'")
    expect(sheet.textContent).not.toContain('from an earlier app run')
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click())
    expect(segment()).toBeNull()
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()
  })

  it('expands the only live command with ANSI-free output and stops it', async () => {
    const sessions = [
      shell('shell-a', 'thread-a', 'npm run dev', { output: '\u001B[32mready\u001B[39m in 412 ms' }),
      settled('shell-b', 'npm run lint', 0)
    ]
    runtimeRequest.mockImplementation(async (path: string) => (
      path.endsWith('/stop') ? { ok: true, status: 200, body: '{}' } : response(sessions)
    ))
    await render()
    await openSheet()
    const output = host.querySelector('[data-background-shell-output]')!
    expect(output.textContent).toBe('ready in 412 ms')
    expect(host.querySelector('[data-tray-sheet="shells"]')!.textContent).toContain('Running for 3m 12s · ~/code/kun')
    const rows = host.querySelectorAll('[data-background-shell-row]')
    expect(rows).toHaveLength(2)
    expect(rows[1]!.textContent).toContain('Exit code 0')
    expect(rows[1]!.textContent).not.toContain('Stop')
    await act(async () => buttonByText('Stop')!.click())
    await settle()
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/background-shells/shell-a/stop', 'POST')
  })

  it('keeps the lone command\'s output open after it finishes or is stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let sessions = [shell('shell-a', 'thread-a', 'npm run build', { output: 'building…' })]
    runtimeRequest.mockImplementation(async () => response(sessions))
    await render()
    await openSheet()
    expect(host.querySelector('[data-background-shell-output]')?.textContent).toBe('building…')
    sessions = [settled('shell-a', 'npm run build', 0, { output: 'building…\nbuilt in 3.1s' })]
    await act(async () => { vi.advanceTimersByTime(2000) })
    await settle()
    expect(host.querySelector('[data-tray-sheet="shells"]')).not.toBeNull()
    expect(host.querySelector('[data-background-shell-row="shell-a"]')?.getAttribute('data-outcome')).toBe('succeeded')
    expect(host.querySelector('[data-background-shell-output]')?.textContent).toBe('building…\nbuilt in 3.1s')
  })

  it('keeps the output open after Stop', async () => {
    let sessions = [shell('shell-a', 'thread-a', 'npm run dev', { output: 'ready' })]
    runtimeRequest.mockImplementation(async (path: string) => {
      if (!path.endsWith('/stop')) return response(sessions)
      sessions = [shell('shell-a', 'thread-a', 'npm run dev', {
        status: 'stopped', exitCode: 143, finishedAt: new Date().toISOString(), output: 'ready'
      })]
      return { ok: true, status: 200, body: '{}' }
    })
    await render()
    await openSheet()
    await act(async () => buttonByText('Stop')!.click())
    await settle()
    expect(host.querySelector('[data-background-shell-row="shell-a"]')?.getAttribute('data-outcome')).toBe('stopped')
    expect(host.querySelector('[data-background-shell-output]')?.textContent).toBe('ready')
  })

  it('copies the output instead when the composer refuses the attachment', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    attach.result = false
    runtimeRequest.mockImplementation(async () => response([
      settled('fail', 'npm test', 1, { output: 'AssertionError: expected 1 to be 2' }),
      settled('quiet', 'npm run nothing', 2)
    ]))
    await render()
    await openSheet()
    const sendTitles = ['Attach this output to the message box', "Couldn't attach this output to the message box"]
    const sendButtons = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('[data-tray-sheet="shells"] button')]
      .filter((button) => sendTitles.includes(button.title))
    await act(async () => sendButtons()[0]!.click())
    await settle()
    expect(attach.calls).toHaveLength(1)
    expect(writeText).toHaveBeenCalledWith('AssertionError: expected 1 to be 2')
    expect(host.querySelector('[data-tray-sheet="shells"]')).not.toBeNull()
    expect(sendButtons()[0]!.textContent).toBe('Copied instead')
    expect(sendButtons()[0]!.getAttribute('data-send-notice')).toBe('copied')
    // Nothing to copy either: say so instead of doing nothing.
    await act(async () => sendButtons()[1]!.click())
    await settle()
    expect(sendButtons()[1]!.textContent).toBe("Can't attach")
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('attaches a failure to the main composer, and offers copy in a side conversation', async () => {
    runtimeRequest.mockImplementation(async () => response([
      settled('fail', 'npm test', 1, { output: 'FAIL src/a.test.ts\nAssertionError: expected 1 to be 2' })
    ]))
    await render()
    await openSheet()
    await act(async () => buttonByText('Send to Kun')!.click())
    await settle()
    expect(attach.calls).toHaveLength(1)
    expect(attach.calls[0]).toMatchObject({
      workspaceRoot: '',
      draft: { source: 'command', command: 'npm test', exitCode: 1, cwdLabel: '~/code/kun' }
    })
    // A successful attach closes the sheet so the composer chip is in view.
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()

    await render({ compact: true, side: true })
    await openSheet()
    expect(buttonByText('Send to Kun')).toBeUndefined()
    expect(host.querySelector('button[aria-label="Copy output"]')).not.toBeNull()
  })

  it('keeps keyboard focus on a row toggle and reports it as a disclosure', async () => {
    runtimeRequest.mockImplementation(async () => response([
      shell('shell-a', 'thread-a', 'npm run dev', { output: 'ready' }),
      shell('shell-b', 'thread-a', 'npx tsc --watch', { output: 'Watching for file changes.' })
    ]))
    await render()
    await openSheet()
    // Two live commands: nothing is expanded by default.
    const toggle = host.querySelector<HTMLButtonElement>('[data-background-shell-row="shell-b"] .ds-composer-tray-row-open')!
    const detail = (): HTMLElement => host.querySelector<HTMLElement>('[data-background-shell-row="shell-b"] [data-background-shell-detail]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe(detail().id)
    expect(detail().hidden).toBe(true)
    toggle.focus()
    await act(async () => toggle.click())
    expect(host.querySelector('[data-background-shell-row="shell-b"] .ds-composer-tray-row-open')).toBe(toggle)
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Hide output of npx tsc --watch')
    expect(detail().hidden).toBe(false)
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.textContent).toContain('Watching for file changes.')
    await act(async () => toggle.click())
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(detail().hidden).toBe(true)
    expect(host.querySelector('[data-background-shell-output]')).toBeNull()
  })

  it('keeps the segment, the open sheet and the picked row through a failed poll', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sessions = [
      shell('shell-a', 'thread-a', 'npm run dev', { output: 'ready' }),
      shell('shell-b', 'thread-a', 'npx tsc --watch', { output: 'Watching for file changes.' })
    ]
    runtimeRequest.mockImplementation(async () => response(sessions))
    await render()
    await openSheet()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-background-shell-row="shell-b"] .ds-composer-tray-row-open')!.click())
    const transient: RuntimeRequestResult[] = [
      { ok: false, status: 500, body: 'Internal Server Error' },
      { ok: false, status: 0, body: '' },
      { ok: true, status: 200, body: '<html>proxy error</html>' }
    ]
    for (const result of transient) {
      runtimeRequest.mockImplementation(async () => result)
      await act(async () => { vi.advanceTimersByTime(2000) })
      await settle()
      expect(segment()).not.toBeNull()
      expect(host.querySelector('[data-tray-sheet="shells"]')).not.toBeNull()
      expect(host.querySelector('[data-background-shell-output]')?.textContent).toBe('Watching for file changes.')
    }
    // A runtime without the route (404) has no background shells.
    runtimeRequest.mockImplementation(async () => ({ ok: false, status: 404, body: '' }))
    await act(async () => { vi.advanceTimersByTime(2000) })
    await settle()
    expect(segment()).toBeNull()
  })

  it('ignores an earlier response after the active thread changes', async () => {
    const first = deferred<RuntimeRequestResult>()
    const second = deferred<RuntimeRequestResult>()
    runtimeRequest.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render()
    await render({ activeThreadId: 'thread-b' })
    second.resolve(response([shell('shell-b', 'thread-b', 'current command')]))
    await settle()
    expect(segment()!.textContent).toContain('current command')
    first.resolve(response([shell('shell-a', 'thread-a', 'stale command')]))
    await settle()
    expect(host.textContent).not.toContain('stale command')
    expect(segment()!.textContent).toContain('current command')
  })

  it('does not re-render the tray when a poll returns the same shells', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sessions = [shell('shell-a', 'thread-a', 'npm run dev')]
    runtimeRequest.mockImplementation(async () => response(sessions))
    await render()
    const before = renders.count
    const calls = runtimeRequest.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(4000) })
    await settle()
    expect(runtimeRequest.mock.calls.length).toBeGreaterThan(calls)
    expect(renders.count).toBe(before)
  })

  it('renders the Chinese copy', async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
    runtimeRequest.mockImplementation(async () => response([
      shell('a', 'thread-a', 'npm run dev'),
      shell('b', 'thread-a', 'npx tsc --watch'),
      settled('c', 'npx vitest', 1)
    ]))
    await render()
    expect(segment()!.textContent).toContain('3 个后台命令')
    expect(segment()!.getAttribute('aria-label')).toBe('后台命令：2 个在后台 · 1 个失败')
    await openSheet()
    const sheet = host.querySelector('[data-tray-sheet="shells"]')!
    expect(sheet.textContent).toContain('后台命令')
    expect(sheet.textContent).toContain('3 分 12 秒 · 2 个在后台 · 1 个失败')
    expect(sheet.textContent).toContain('已运行 3 分 12 秒')
    expect(sheet.textContent).toContain('退出码 1 · 刚刚')
    expect(sheet.textContent).toContain('复制输出')
    expect(sheet.textContent).toContain('发给 Kun')
    expect(sheet.textContent).not.toContain('composerTrayShells.')
  })
})
