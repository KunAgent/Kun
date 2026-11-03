export type AppRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string }

let sequence = 0

function errorText(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown }
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.trim()) return message.slice(0, 500)
  } catch {
    // fall through to the status text
  }
  return `Request failed (HTTP ${status})`
}

/** JSON request to the Kun runtime through the workbench bridge, with cancellation. */
export async function appRuntimeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<AppRuntimeResult<T>> {
  if (typeof window === 'undefined' || typeof window.kunGui?.runtimeRequest !== 'function') {
    return { ok: false, status: 0, message: 'Runtime is unavailable' }
  }
  signal?.throwIfAborted()
  const requestId = signal ? `app-surface-${Date.now().toString(36)}-${(++sequence).toString(36)}` : undefined
  const cancel = (): void => {
    if (requestId) void window.kunGui.cancelRuntimeRequest?.(requestId).catch(() => false)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await window.kunGui.runtimeRequest(
      path,
      method,
      body === undefined ? undefined : JSON.stringify(body),
      requestId ? { requestId } : undefined
    )
    if (!response.ok) return { ok: false, status: response.status, message: errorText(response.body, response.status) }
    try {
      return { ok: true, value: JSON.parse(response.body) as T }
    } catch {
      return { ok: false, status: response.status, message: 'Invalid runtime response' }
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
