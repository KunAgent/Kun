import { RemoteApi, type DeviceIdentity } from '@kun/remote-protocol'

/** Rejects cancelled or stalled work even when its transport ignores abort. */
export async function sessionOperation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('ACCOUNT_CHANGED')
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = () => {}
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('ACCOUNT_CHANGED')
        return operation()
      }),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('ACCOUNT_CHANGED'))
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('CONNECTION_UNAVAILABLE')), 15000)
      })
    ])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

/** A bounded cleanup attempt with the ending session's fixed credentials. */
export async function disableHost(deps: {
  origin: string
  fetch: typeof fetch
  identity: DeviceIdentity
  token: string
}): Promise<boolean> {
  const control = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const api = new RemoteApi({
    origin: deps.origin,
    fetch: deps.fetch,
    identity: async () => deps.identity,
    token: async () => deps.token
  })
  try {
    return await Promise.race([
      api.request('/devices/enabled', 'PUT', { enabled: false }, false, control.signal)
        .then(() => true, () => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          control.abort()
          resolve(false)
        }, 5000)
      })
    ])
  } finally {
    clearTimeout(timer)
    control.abort()
  }
}
