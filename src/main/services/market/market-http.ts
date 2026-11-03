import * as electron from 'electron'
import type { MarketFetch } from './market-source'

/** Electron's network stack honors the desktop's proxy configuration. */
export const marketFetch: MarketFetch = (url, init) => {
  if (typeof electron === 'object' && electron !== null && 'net' in electron && typeof electron.net?.fetch === 'function') {
    return electron.net.fetch(url, init)
  }
  // Unit tests run in Node with a partial Electron mock; production never
  // silently falls back to Node's different proxy behaviour.
  if (process.env.NODE_ENV === 'test') return fetch(url, init)
  throw new Error('Electron network transport is unavailable for market requests')
}
