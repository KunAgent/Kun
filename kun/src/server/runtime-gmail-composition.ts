import { NativeGmailService } from '../gmail/service.js'
import { spawn } from 'node:child_process'
import type { GmailServicePort } from '../gmail/ports.js'
import { createGmailGoogleFetch } from '../gmail/google-network-transport.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { EncryptedGmailOAuthClientStore, type GmailDesktopOAuthConfiguration } from '../gmail/oauth-client-config.js'
import { bootstrapPackagedGmailOAuthClient } from '../gmail/packaged-oauth-client.js'
import type { SecretEncryptor } from '../security/secret-store.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { createUnavailableRuntimeGmail } from './runtime-gmail-unavailable.js'

/** Native mailbox credentials remain inside the local Runtime's encrypted store. */
export async function createRuntimeGmailComposition(
  model: { core: { activeOptions: KunServeRuntimeOptions };
    extensionCredentialKeyProvider: { encryptor: SecretEncryptor };
    networkProxy?: () => Promise<string> }
): Promise<GmailServicePort> {
  const dataDir = model.core.activeOptions.dataDir
  let client: GmailDesktopOAuthConfiguration | undefined
  try {
    client = await bootstrapPackagedGmailOAuthClient({
      store: new EncryptedGmailOAuthClientStore(dataDir, model.extensionCredentialKeyProvider.encryptor),
      assertDataProtection: () => assertEncryptedGmailStorage(dataDir)
    })
  } catch {
    // Missing or invalid client config disables Gmail access, not healthy account-store classification.
  }
  try {
    const gmail = new NativeGmailService({
      dataDir,
      clientSecret: client?.clientSecret,
      requireClientSecret: true,
      assertDataProtection: () => assertEncryptedGmailStorage(dataDir),
      encryptor: model.extensionCredentialKeyProvider.encryptor,
      // Google networking stays independent of managed local inference's mandatory NoProxy transport.
      fetchImpl: createGmailGoogleFetch({ appProxy: async () =>
        await model.networkProxy?.() ?? model.core.activeOptions.modelProxyUrl ?? '' }),
      openExternal: async (value) => {
        const url = new URL(value)
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') {
          throw new Error('Unexpected Gmail authorization destination')
        }
        await openGoogleAuthorization(url)
      }
    })
    await gmail.initialize()
    return client ? gmail : createUnavailableRuntimeGmail(gmail)
  } catch {
    // Unknown classification from damaged account credentials must still fail closed.
    return createUnavailableRuntimeGmail()
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
