import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { UiPluginCdpThemeController } from './ui-plugin-cdp-theme-controller'

class FakeDebugger extends EventEmitter {
  attached = false
  readonly attach = vi.fn((_version: string) => {
    if (this.attached) throw new Error('already attached')
    this.attached = true
  })
  readonly isAttached = vi.fn(() => this.attached)
  readonly sendCommand = vi.fn(async (
    _method: string,
    _parameters?: Record<string, unknown>
  ) => ({ result: { value: true } }))
  readonly detach = vi.fn(() => {
    this.attached = false
    this.emit('detach', {}, 'target closed')
  })
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  devToolsOpened = false
  readonly debugger = new FakeDebugger()

  isDestroyed(): boolean {
    return this.destroyed
  }

  isDevToolsOpened(): boolean {
    return this.devToolsOpened
  }
}

function controllerFixture() {
  const contents = new FakeWebContents()
  const backgroundErrors = vi.fn()
  const controller = new UiPluginCdpThemeController({
    getWebContents: () => contents as unknown as WebContents,
    onBackgroundError: backgroundErrors
  })
  return { contents, controller, backgroundErrors }
}

describe('UiPluginCdpThemeController', () => {
  it('injects only the fixed runtime with JSON-encoded host CSS and detaches immediately', async () => {
    const { contents, controller } = controllerFixture()
    const css = `html[data-ui-plugin='starlight'] { --ds-accent: #7654d8; }\n` +
      `/* inert even as text: '); globalThis.__kunPluginCodeRan = true; // */`

    await controller.activate('starlight', css)

    expect(controller.activePluginId).toBe('starlight')
    expect(contents.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(contents.debugger.sendCommand).toHaveBeenCalledOnce()
    expect(contents.debugger.sendCommand.mock.calls[0]?.[0]).toBe('Runtime.evaluate')
    const parameters = contents.debugger.sendCommand.mock.calls[0]?.[1] as {
      expression: string
      returnByValue: boolean
      includeCommandLineAPI: boolean
    }
    expect(parameters.returnByValue).toBe(true)
    expect(parameters.includeCommandLineAPI).toBe(false)
    expect(parameters.expression).toContain('style.textContent = payload.css')
    expect(parameters.expression).toContain('JSON.parse(payloadJson)')
    expect(parameters.expression).toContain('starlight')
    expect(parameters.expression).toContain('globalThis.__kunPluginCodeRan')
    expect(contents.debugger.detach).toHaveBeenCalledOnce()
    expect(contents.debugger.attached).toBe(false)

    const style = {
      tagName: 'STYLE',
      id: '',
      textContent: '',
      setAttribute: vi.fn(),
      remove: vi.fn()
    }
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    const documentFixture = {
      documentElement: root,
      head: { appendChild: vi.fn() },
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => style)
    }
    delete (globalThis as Record<string, unknown>).__kunPluginCodeRan
    const runFixedRuntime = new Function('document', `return ${parameters.expression}`)
    expect(runFixedRuntime(documentFixture)).toBe(true)
    expect(style.textContent).toBe(css)
    expect((globalThis as Record<string, unknown>).__kunPluginCodeRan).toBeUndefined()
  })

  it('does not attach, evaluate, or detach when DevTools owns the debugger', async () => {
    const { contents, controller } = controllerFixture()
    contents.debugger.attached = true

    await expect(controller.activate('starlight', 'html {}')).rejects.toThrow(
      /DevTools or another debugger is attached/
    )

    expect(contents.debugger.attach).not.toHaveBeenCalled()
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
    expect(contents.debugger.detach).not.toHaveBeenCalled()
    expect(contents.debugger.attached).toBe(true)
  })

  it('does not attach when DevTools is open even if debugger.isAttached reports false', async () => {
    const { contents, controller } = controllerFixture()
    contents.devToolsOpened = true

    await expect(controller.activate('starlight', 'html {}')).rejects.toThrow(
      /DevTools or another debugger is attached/
    )

    expect(contents.debugger.attach).not.toHaveBeenCalled()
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
    expect(contents.debugger.detach).not.toHaveBeenCalled()
  })

  it('detaches its own session when Runtime.evaluate fails', async () => {
    const { contents, controller } = controllerFixture()
    contents.debugger.sendCommand.mockRejectedValueOnce(new Error('execution context destroyed'))

    await expect(controller.activate('starlight', 'html {}')).rejects.toThrow(
      /execution context destroyed/
    )

    expect(contents.debugger.detach).toHaveBeenCalledOnce()
    expect(contents.debugger.attached).toBe(false)
    expect(controller.activePluginId).toBeNull()
  })

  it('reports a detach failure and can safely recover its own recorded session', async () => {
    const { contents, controller, backgroundErrors } = controllerFixture()
    contents.debugger.detach.mockImplementationOnce(() => {
      throw new Error('temporary detach failure')
    })

    await expect(controller.activate('starlight', 'html {}')).rejects.toThrow(
      /Unable to detach the Kun UI theme CDP session/
    )
    expect(contents.debugger.attached).toBe(true)
    expect(backgroundErrors).toHaveBeenCalledWith('detach', expect.any(Error))

    // deactivate first releases the controller-owned leftover session, then
    // opens a fresh short-lived session to clear the style node.
    await controller.deactivate()
    expect(contents.debugger.attached).toBe(false)
    expect(contents.debugger.detach).toHaveBeenCalledTimes(3)
  })

  it('reapplies the active host CSS after the renderer finishes a reload', async () => {
    const { contents, controller } = controllerFixture()
    await controller.activate('starlight', 'html { --ds-accent: #7654d8; }')

    contents.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(2)
    })

    expect(contents.debugger.attach).toHaveBeenCalledTimes(2)
    expect(contents.debugger.detach).toHaveBeenCalledTimes(2)
  })

  it('clears the single host style through CDP and forgets the active plugin', async () => {
    const { contents, controller } = controllerFixture()
    await controller.activate('starlight', 'html {}')
    await controller.deactivate()

    expect(controller.activePluginId).toBeNull()
    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(2)
    const parameters = contents.debugger.sendCommand.mock.calls[1]?.[1] as { expression: string }
    expect(parameters.expression).toContain('kun-ui-plugin-theme-cdp')
    expect(parameters.expression).toContain('clear')
    expect(contents.debugger.detach).toHaveBeenCalledTimes(2)
  })

  it('keeps the active identity when CDP clear fails so removal can retry safely', async () => {
    const { contents, controller } = controllerFixture()
    await controller.activate('starlight', 'html {}')
    contents.debugger.attached = true

    await expect(controller.deactivate()).rejects.toThrow(/another debugger is attached/)

    expect(controller.activePluginId).toBe('starlight')
    expect(contents.debugger.detach).toHaveBeenCalledTimes(1)
  })

  it('does not detach a replacement debugger after its own session is detached unexpectedly', async () => {
    const { contents, controller } = controllerFixture()
    contents.debugger.sendCommand.mockImplementationOnce(async () => {
      contents.debugger.attached = false
      contents.debugger.emit('detach', {}, 'replaced')
      // Simulate another debugger attaching before the command rejects.
      contents.debugger.attached = true
      throw new Error('session replaced')
    })

    await expect(controller.activate('starlight', 'html {}')).rejects.toThrow(/session replaced/)

    expect(contents.debugger.detach).not.toHaveBeenCalled()
    expect(contents.debugger.attached).toBe(true)
  })
})
