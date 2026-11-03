import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { GmailError } from './ports.js'
import { EncryptedGmailOAuthClientStore, parsePackagedGmailOAuthClient,
  type GmailDesktopOAuthConfiguration, type PackagedGmailOAuthConfiguration } from './oauth-client-config.js'

const RESOURCE = new URL('../resources/gmail-native-client.json', import.meta.url)
const MAX_BYTES = 16_384

/** Only the fixed Runtime package resource is used; no renderer, HTTP or environment override. */
export async function bootstrapPackagedGmailOAuthClient(input: {
  store: EncryptedGmailOAuthClientStore; assertDataProtection: () => Promise<void>
}, dependencies: {
  platform?: NodeJS.Platform;
  readConfiguration?: () => Promise<PackagedGmailOAuthConfiguration | undefined>
} = {}): Promise<GmailDesktopOAuthConfiguration | undefined> {
  // Damaged local credentials remain evidence; a package must not silently overwrite them.
  const installed = await input.store.read()
  if ((dependencies.platform ?? process.platform) !== 'darwin') return installed
  const packaged = await (dependencies.readConfiguration ?? readPackagedGmailOAuthClient)()
  if (!packaged) return installed
  const approved = parsePackagedGmailOAuthClient(packaged)
  if (installed?.clientSecret === approved.clientSecret) return installed
  await input.assertDataProtection()
  await input.store.install(approved.clientSecret)
  return input.store.read()
}

/** File reader accepts an injectable URL only for host tests, never from a user request. */
export async function readPackagedGmailOAuthClient(resource: URL = RESOURCE): Promise<PackagedGmailOAuthConfiguration | undefined> {
  let file
  try { file = await open(resource, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw resourceUnavailable()
  }
  try {
    const details = await file.stat()
    if (!details.isFile() || details.size < 1 || details.size > MAX_BYTES) throw resourceUnavailable()
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const chunk = await file.read(buffer, size, buffer.length - size, null)
      if (!chunk.bytesRead) break
      size += chunk.bytesRead
    }
    if (size > MAX_BYTES) throw resourceUnavailable()
    return parsePackagedGmailOAuthClient(JSON.parse(buffer.subarray(0, size).toString('utf8')))
  } catch { throw resourceUnavailable() }
  finally { await file.close() }
}

function resourceUnavailable(): GmailError {
  return new GmailError('client_configuration_unavailable', 'This Kun package has invalid Gmail client configuration. Install an official configured macOS release')
}
