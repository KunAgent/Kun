import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import type {
  CredentialRecoveryResetResult,
  RuntimeRequestResult,
  SseEndPayload,
  SseErrorPayload,
  SseEventPayload,
  SseOpenPayload
} from '@shared/kun-gui-api'

class RendererRuntimeClient {
  private cachedSettings: AppSettingsV1 | null = null
  private settingsPromise: Promise<AppSettingsV1> | null = null

  getSettings(options?: { forceRefresh?: boolean }): Promise<AppSettingsV1> {
    if (options?.forceRefresh) {
      this.invalidateSettings()
    }
    if (this.cachedSettings) return Promise.resolve(this.cachedSettings)
    if (this.settingsPromise) return this.settingsPromise
    const task = window.kunGui.getSettings()
      .then((settings) => {
        if (this.settingsPromise === task) this.cachedSettings = settings
        return settings
      })
    this.settingsPromise = task
    void task.finally(() => {
      if (this.settingsPromise === task) this.settingsPromise = null
    }).catch(() => undefined)
    return task
  }

  async setSettings(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    const settings = await window.kunGui.setSettings(partial)
    this.cachedSettings = settings
    this.settingsPromise = null
    return settings
  }

  async resetUnreadableCredentials(): Promise<CredentialRecoveryResetResult> {
    const result = await window.kunGui.resetUnreadableCredentials()
    if (result.reset) this.invalidateSettings()
    return result
  }

  invalidateSettings(): void {
    this.cachedSettings = null
    this.settingsPromise = null
  }

  async runtimeRequest(
    path: string,
    method?: string,
    body?: string,
    options: {
      signal?: AbortSignal
      priority?: 'foreground' | 'background'
    } = {}
  ): Promise<RuntimeRequestResult> {
    options.signal?.throwIfAborted()
    const requestId = options.signal
      ? `renderer-${Date.now().toString(36)}-${(++runtimeRequestSequence).toString(36)}`
      : undefined
    const requestOptions = requestId || options.priority
      ? { ...(requestId ? { requestId } : {}), ...(options.priority ? { priority: options.priority } : {}) }
      : undefined
    const cancel = (): void => {
      if (!requestId || typeof window.kunGui.cancelRuntimeRequest !== 'function') return
      void window.kunGui.cancelRuntimeRequest(requestId).catch(() => false)
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      const response = requestOptions
        ? window.kunGui.runtimeRequest(path, method, body, requestOptions)
        : body === undefined
          ? method === undefined
            ? window.kunGui.runtimeRequest(path)
            : window.kunGui.runtimeRequest(path, method)
          : window.kunGui.runtimeRequest(path, method, body)
      const result = await response
      options.signal?.throwIfAborted()
      return result
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
  }

  restartRuntime(): Promise<void> {
    return window.kunGui.restartRuntime()
  }

  startSse(
    threadId: string,
    sinceSeq: number,
    streamId?: string,
    options?: { acknowledgedBatches?: boolean }
  ): Promise<{ streamId: string }> {
    return window.kunGui.startSse(threadId, sinceSeq, streamId, options)
  }

  stopSse(streamId: string): Promise<boolean> {
    return window.kunGui.stopSse(streamId)
  }

  ackSse(streamId: string, batchId: string): Promise<boolean> {
    return window.kunGui.ackSse(streamId, batchId)
  }

  onSseEvent(handler: (payload: SseEventPayload) => void): () => void {
    return window.kunGui.onSseEvent(handler)
  }

  onSseOpen(handler: (payload: SseOpenPayload) => void): () => void {
    return window.kunGui.onSseOpen(handler)
  }

  onSseEnd(handler: (payload: SseEndPayload) => void): () => void {
    return window.kunGui.onSseEnd(handler)
  }

  onSseError(handler: (payload: SseErrorPayload) => void): () => void {
    return window.kunGui.onSseError(handler)
  }
}

let runtimeRequestSequence = 0

export const rendererRuntimeClient = new RendererRuntimeClient()
