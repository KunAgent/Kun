import { NativeGmailService } from '../gmail/service.js'
import { spawn } from 'node:child_process'
import { GmailError, type GmailServicePort } from '../gmail/ports.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { EncryptedGmailOAuthClientStore } from '../gmail/oauth-client-config.js'
import type { SecretEncryptor } from '../security/secret-store.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

/** Native mailbox credentials remain inside the local Runtime's encrypted store. */
export async function createRuntimeGmailComposition(
  model: { core: { activeOptions: KunServeRuntimeOptions };
    extensionCredentialKeyProvider: { encryptor: SecretEncryptor };
    networkProxy?: () => Promise<string> }
): Promise<GmailServicePort> {
  const dataDir = model.core.activeOptions.dataDir
  try {
    const client = await new EncryptedGmailOAuthClientStore(dataDir, model.extensionCredentialKeyProvider.encryptor).read()
    const gmail = new NativeGmailService({
      dataDir,
      clientSecret: client?.clientSecret,
      requireClientSecret: true,
      assertDataProtection: () => assertEncryptedGmailStorage(dataDir),
      encryptor: model.extensionCredentialKeyProvider.encryptor,
      fetchImpl: async (input, init) => {
        // Google uses the user's global network proxy, independently of local inference routing.
        const proxy = createProxyFetch(await model.networkProxy?.() ?? model.core.activeOptions.modelProxyUrl ?? '')
        return (proxy ?? fetch)(input, init)
      },
      openExternal: async (value) => {
        const url = new URL(value)
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') {
          throw new Error('Unexpected Gmail authorization destination')
        }
        await openGoogleAuthorization(url)
      }
    })
    await gmail.initialize()
    return gmail
  } catch {
    // Preserve damaged credential evidence and keep unrelated Runtime functions available.
    const unavailable = async () => {
      throw new GmailError('storage_unavailable', 'The encrypted Gmail store could not be opened. Restore its key or repair the store before reconnecting.')
    }
    return {
      initialize: unavailable,
      hasGoogleData: unavailable,
      markGoogleData: unavailable,
      captureModelSharingFence: () => { throw new GmailError('service_unavailable', 'Gmail connection is unavailable') },
      status: async () => ({ configured: false, connected: false, reconnectRequired: true,
        scopes: [], allowModelSharing: false }),
      startAuthorize: unavailable, pollAuthorization: unavailable, cancelAuthorization: unavailable,
      disconnect: unavailable, setModelSharing: unavailable, search: unavailable, read: unavailable,
      send: unavailable, dispose: async () => undefined
    }
  }
}

/** System browser launches must report errors without leaving an unhandled child event. */
async function openGoogleAuthorization(url: URL): Promise<void> {
  const command = process.platform === 'darwin' ? '/usr/bin/open'
    : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['url.dll,FileProtocolHandler', url.toString()] : [url.toString()]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser launch timed out')) }, 10_000)
    child.once('error', () => { clearTimeout(timer); reject(new Error('System browser is unavailable')) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('System browser launch failed'))
    })
  })
}
