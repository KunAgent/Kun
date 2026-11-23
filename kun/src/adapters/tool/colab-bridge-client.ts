export type ColabBridgeBinding = {
  url: string
  token: string
  fetchImpl?: typeof fetch
}

/** POSTs JSON to the Kun GUI Colab bridge on loopback with its bearer token. */
export async function callColabBridge<T>(
  binding: ColabBridgeBinding,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const fetchFn = binding.fetchImpl ?? fetch
  const resp = await fetchFn(`${binding.url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${binding.token}`
    },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
  })
  const data = (await resp.json()) as T & { error?: string; message?: string }
  if (!resp.ok) {
    throw new Error(data.message || data.error || `Colab bridge HTTP ${resp.status}`)
  }
  return data
}
