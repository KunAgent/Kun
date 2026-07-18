import type { WebContents } from 'electron'

const UI_PLUGIN_THEME_STYLE_ID = 'kun-ui-plugin-theme-cdp'
const UI_PLUGIN_THEME_MARKER_ATTRIBUTE = 'data-ui-plugin-cdp'
const CDP_PROTOCOL_VERSION = '1.3'

type UiPluginThemePayload =
  | { action: 'apply'; pluginId: string; css: string }
  | { action: 'clear' }

type RuntimeEvaluateResponse = {
  result?: { value?: unknown; description?: string }
  exceptionDetails?: { text?: string }
}

/**
 * This is the only renderer program used by UI theme injection. Plugin data is
 * passed as JSON and can only become style.textContent; no plugin source is
 * concatenated into executable JavaScript.
 */
const UI_PLUGIN_THEME_RUNTIME_SOURCE = `(payloadJson) => {
  'use strict';
  const payload = JSON.parse(payloadJson);
  const styleId = '${UI_PLUGIN_THEME_STYLE_ID}';
  const markerAttribute = '${UI_PLUGIN_THEME_MARKER_ATTRIBUTE}';
  const root = document.documentElement;
  const existing = document.getElementById(styleId);

  if (payload.action === 'clear') {
    if (existing) existing.remove();
    if (root) root.removeAttribute(markerAttribute);
    return true;
  }

  if (
    payload.action !== 'apply' ||
    typeof payload.pluginId !== 'string' ||
    typeof payload.css !== 'string'
  ) {
    return false;
  }

  let style = existing;
  if (!style || style.tagName !== 'STYLE') {
    if (style) style.remove();
    style = document.createElement('style');
    style.id = styleId;
    (document.head || root).appendChild(style);
  }
  style.textContent = payload.css;
  style.setAttribute('data-ui-plugin-id', payload.pluginId);
  if (root) root.setAttribute(markerAttribute, payload.pluginId);
  return true;
}`

function buildRuntimeEvaluateExpression(payload: UiPluginThemePayload): string {
  const payloadJson = JSON.stringify(payload)
  // Double JSON encoding makes the argument one inert string literal even if
  // a generated CSS value contains quotes, newlines, or </style> text.
  return `(${UI_PLUGIN_THEME_RUNTIME_SOURCE})(${JSON.stringify(payloadJson)})`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type UiPluginCdpThemeControllerOptions = {
  getWebContents: () => WebContents | null
  onBackgroundError?: (scope: string, error: unknown) => void
}

type ActiveTheme = {
  pluginId: string
  css: string
}

/**
 * Applies host-generated UI plugin CSS through Electron's in-process CDP
 * bridge. It never opens a remote debugging port and never accepts plugin JS.
 * Each mutation owns a short debugger session and detaches in finally.
 */
export class UiPluginCdpThemeController {
  private activeTheme: ActiveTheme | null = null
  private boundWebContents: WebContents | null = null
  private ownedDebuggerContents: WebContents | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: UiPluginCdpThemeControllerOptions) {}

  get activePluginId(): string | null {
    return this.activeTheme?.pluginId ?? null
  }

  async activate(pluginId: string, css: string): Promise<void> {
    const nextTheme = { pluginId, css }
    await this.enqueue(async () => {
      const contents = this.requireLiveWebContents()
      this.bind(contents)
      await this.evaluate(contents, {
        action: 'apply',
        pluginId: nextTheme.pluginId,
        css: nextTheme.css
      })
      this.activeTheme = nextTheme
    })
  }

  async deactivate(): Promise<void> {
    await this.enqueue(async () => {
      const contents = this.options.getWebContents()
      if (!contents || contents.isDestroyed()) {
        this.activeTheme = null
        return
      }
      this.bind(contents)
      await this.evaluate(contents, { action: 'clear' })
      // Keep the active identity when clear fails. Callers such as plugin
      // removal must not assume a stale injected style has been removed.
      this.activeTheme = null
    })
  }

  dispose(): void {
    this.activeTheme = null
    const ownedContents = this.ownedDebuggerContents
    if (ownedContents && !ownedContents.isDestroyed() && ownedContents.debugger.isAttached()) {
      try {
        ownedContents.debugger.detach()
      } catch (error) {
        this.options.onBackgroundError?.('dispose-detach', error)
      }
    }
    this.ownedDebuggerContents = null
    this.unbind()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private requireLiveWebContents(): WebContents {
    const contents = this.options.getWebContents()
    if (!contents || contents.isDestroyed()) {
      throw new Error('Kun workbench is unavailable for CDP theme injection.')
    }
    return contents
  }

  private bind(contents: WebContents): void {
    if (this.boundWebContents === contents) return
    this.unbind()
    this.boundWebContents = contents
    contents.on('did-finish-load', this.handleDidFinishLoad)
    contents.once('destroyed', this.handleDestroyed)
  }

  private unbind(): void {
    const contents = this.boundWebContents
    if (!contents) return
    contents.removeListener('did-finish-load', this.handleDidFinishLoad)
    contents.removeListener('destroyed', this.handleDestroyed)
    this.boundWebContents = null
  }

  private readonly handleDestroyed = (): void => {
    this.activeTheme = null
    if (this.ownedDebuggerContents === this.boundWebContents) {
      this.ownedDebuggerContents = null
    }
    this.unbind()
  }

  private readonly handleDidFinishLoad = (): void => {
    const contents = this.boundWebContents
    const theme = this.activeTheme
    if (!contents || !theme || contents.isDestroyed()) return

    void this.enqueue(async () => {
      if (
        this.boundWebContents !== contents ||
        this.activeTheme !== theme ||
        contents.isDestroyed()
      ) {
        return
      }
      await this.evaluate(contents, {
        action: 'apply',
        pluginId: theme.pluginId,
        css: theme.css
      })
    }).catch((error) => {
      this.options.onBackgroundError?.('reapply-after-load', error)
    })
  }

  private async evaluate(contents: WebContents, payload: UiPluginThemePayload): Promise<void> {
    const cdp = contents.debugger
    // A previous best-effort detach may have failed. Because this controller
    // recorded ownership, it may retry releasing that exact session; it never
    // does this for an unknown debugger.
    if (this.ownedDebuggerContents === contents) {
      if (cdp.isAttached()) {
        try {
          cdp.detach()
        } catch (error) {
          throw new Error(
            `Unable to release the previous Kun UI theme CDP session: ${errorMessage(error)}`
          )
        }
      }
      this.ownedDebuggerContents = null
    }
    if (contents.isDevToolsOpened() || cdp.isAttached()) {
      throw new Error(
        'CDP theme injection is unavailable while DevTools or another debugger is attached.'
      )
    }

    let attachedByController = false
    let sessionDetached = false
    const handleDetach = (): void => {
      sessionDetached = true
      if (this.ownedDebuggerContents === contents) {
        this.ownedDebuggerContents = null
      }
      cdp.removeListener('detach', handleDetach)
    }
    cdp.on('detach', handleDetach)

    let failure: Error | null = null
    try {
      cdp.attach(CDP_PROTOCOL_VERSION)
      attachedByController = true
      this.ownedDebuggerContents = contents
      const response = (await cdp.sendCommand('Runtime.evaluate', {
        expression: buildRuntimeEvaluateExpression(payload),
        returnByValue: true,
        includeCommandLineAPI: false,
        userGesture: false
      })) as RuntimeEvaluateResponse

      if (response.exceptionDetails) {
        throw new Error(
          `CDP theme Runtime.evaluate failed: ${response.exceptionDetails.text ?? 'unknown exception'}`
        )
      }
      if (response.result?.value !== true) {
        throw new Error(
          `CDP theme Runtime.evaluate returned an unexpected result${
            response.result?.description ? `: ${response.result.description}` : '.'
          }`
        )
      }
    } catch (error) {
      failure = new Error(`Unable to update the Kun UI theme through CDP: ${errorMessage(error)}`)
    } finally {
      if (attachedByController && !sessionDetached && cdp.isAttached()) {
        try {
          cdp.detach()
          if (this.ownedDebuggerContents === contents) {
            this.ownedDebuggerContents = null
          }
        } catch (error) {
          this.options.onBackgroundError?.('detach', error)
          failure ??= new Error(
            `Unable to detach the Kun UI theme CDP session: ${errorMessage(error)}`
          )
        }
      } else if (attachedByController && !cdp.isAttached()) {
        this.ownedDebuggerContents = null
      }
      // If detach failed, retain this one-shot ownership listener. Should the
      // session later be replaced, it clears ownership before another caller
      // can mistake the replacement debugger for ours.
      if (this.ownedDebuggerContents !== contents) {
        cdp.removeListener('detach', handleDetach)
      }
    }
    if (failure) throw failure
  }
}
