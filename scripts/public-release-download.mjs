import { setTimeout as sleep } from 'node:timers/promises'

const transientCodes = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
  'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'
])

function isTransient(error) {
  return error?.name === 'TimeoutError' || transientCodes.has(error?.code) ||
    error?.status === 408 || error?.status === 429 ||
    (error?.status >= 500 && error?.status <= 599) ||
    (error?.cause && isTransient(error.cause)) ||
    (Array.isArray(error?.errors) && error.errors.some(isTransient))
}

function describe(error) {
  const details = [error?.code, error?.message, error?.cause && describe(error.cause)]
  if (Array.isArray(error?.errors)) details.push(...error.errors.map(describe))
  return details.filter(Boolean).join(': ')
}

// Consume the entire response within each attempt so interrupted downloads restart
// with fresh hashes. Content validation errors must still fail immediately.
export async function downloadPublicRelease(url, consume, {
  fetchResponse = fetch,
  wait = sleep,
  log = console.log,
  attempts = 4,
  timeoutMs = 10 * 60_000
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
    try {
      log(`[public-release] GET ${url} (attempt ${attempt}/${attempts})`)
      const response = await fetchResponse(url, { signal, cache: 'no-store' })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      return await consume(response)
    } catch (error) {
      if (attempt === attempts || !isTransient(error)) {
        throw new Error(`Download failed for ${url} after ${attempt} attempt(s): ${describe(error)}`, { cause: error })
      }
      controller.abort()
      const delay = 1000 * 2 ** (attempt - 1)
      log(`[public-release] Retry ${url} in ${delay}ms: ${describe(error)}`)
      await wait(delay)
    } finally {
      controller.abort()
    }
  }
}
