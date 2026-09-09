import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

export class SemanticMemoryNetworkAccessError extends Error {
  constructor(readonly attempts: number) {
    super('semantic memory evaluation candidates cannot access the network')
    this.name = 'SemanticMemoryNetworkAccessError'
  }
}

export async function runWithSemanticMemoryNetworkGuard<T>(
  action: () => Promise<T>
): Promise<{ value: T; networkAttempts: number }> {
  let attempts = 0
  const originalFetch = globalThis.fetch
  const originalHttpRequest = http.request
  const originalHttpsRequest = https.request
  const originalNetConnect = net.connect
  const originalTlsConnect = tls.connect
  const blocked = () => {
    attempts += 1
    throw new SemanticMemoryNetworkAccessError(attempts)
  }

  globalThis.fetch = (async () => blocked()) as typeof fetch
  http.request = blocked as typeof http.request
  https.request = blocked as typeof https.request
  net.connect = blocked as typeof net.connect
  tls.connect = blocked as typeof tls.connect
  try {
    return { value: await action(), networkAttempts: attempts }
  } finally {
    globalThis.fetch = originalFetch
    http.request = originalHttpRequest
    https.request = originalHttpsRequest
    net.connect = originalNetConnect
    tls.connect = originalTlsConnect
  }
}
