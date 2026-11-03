import { GmailError, type GmailServicePort } from '../gmail/ports.js'

/** Unavailable authentication must retain known history classification without granting access. */
export function createUnavailableRuntimeGmail(classification?: GmailServicePort): GmailServicePort {
  const unavailable = async () => {
    throw new GmailError(classification ? 'client_configuration_unavailable' : 'storage_unavailable', classification
      ? 'This Kun installation has no usable Gmail client configuration. Install a configured official release or repair the local operator configuration'
      : 'The encrypted Gmail store could not be opened. Restore its key or repair the store before reconnecting')
  }
  return {
    initialize: unavailable,
    hasGoogleData: classification ? (scope) => classification.hasGoogleData(scope) : unavailable,
    markGoogleData: classification ? (scope) => classification.markGoogleData(scope) : unavailable,
    captureModelSharingFence: () => { throw new GmailError('service_unavailable', 'Gmail connection is unavailable') },
    status: async () => ({ configured: false, connected: false, reconnectRequired: !classification,
      scopes: [], allowModelSharing: false }),
    startAuthorize: unavailable, pollAuthorization: unavailable, cancelAuthorization: unavailable,
    disconnect: unavailable, setModelSharing: unavailable, search: unavailable, read: unavailable,
    send: unavailable, dispose: async () => { await classification?.dispose() }
  }
}
