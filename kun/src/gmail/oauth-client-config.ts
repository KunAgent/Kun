import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile, assertManagerAtomicJsonPath, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { isEncryptedEnvelope, type SecretEncryptor } from '../security/secret-store.js'
import { GmailError, KUN_GMAIL_CLIENT_ID } from './ports.js'

const AAD = 'kun-native-gmail-desktop-oauth-client:v1'
const Secret = z.string().min(12).max(1_024).regex(/^[\x21-\x7e]+$/u)
const Configuration = z.object({ schemaVersion: z.literal(1), clientId: z.literal(KUN_GMAIL_CLIENT_ID),
  clientSecret: Secret, installedAt: z.iso.datetime() }).strict()
const Envelope = z.object({ schemaVersion: z.literal(1), __enc: z.string() }).strict()
export type GmailDesktopOAuthConfiguration = z.infer<typeof Configuration>

/** Google requires this Desktop client identifier for both code exchange and refresh. */
export class EncryptedGmailOAuthClientStore {
  private readonly file: AtomicJsonFile<z.infer<typeof Envelope> | null>
  constructor(dataDir: string, private readonly encryptor: SecretEncryptor) {
    const path = join(dataDir, 'mcp-oauth', 'native-google-gmail-client.json')
    assertManagerAtomicJsonPath(path)
    this.file = new AtomicJsonFile(path, (value) => {
      if (value === null) return null
      const parsed = Envelope.safeParse(value)
      if (!parsed.success || !isEncryptedEnvelope(parsed.data.__enc)) throw configurationUnavailable()
      return parsed.data
    }, false)
  }

  async read(): Promise<GmailDesktopOAuthConfiguration | undefined> {
    try {
      const envelope = await this.file.read(() => null)
      if (!envelope) return undefined
      return Configuration.parse(JSON.parse(this.encryptor.decrypt(envelope.__enc, AAD)))
    } catch { throw configurationUnavailable() }
  }

  /** Operator CLI only; canonical writes must pass through the owned Service Manager. */
  async install(clientSecret: string, installedAt = new Date().toISOString()): Promise<{ clientId: string; installedAt: string }> {
    if (!isManagerAtomicJsonPath(this.file.path)) throw configurationUnavailable()
    const configuration = Configuration.safeParse({ schemaVersion: 1, clientId: KUN_GMAIL_CLIENT_ID,
      clientSecret: clientSecret.trim(), installedAt })
    if (!configuration.success) throw invalidConfiguration()
    await this.file.update(() => null, () => ({ schemaVersion: 1,
      __enc: this.encryptor.encrypt(JSON.stringify(configuration.data), AAD) }))
    return { clientId: configuration.data.clientId, installedAt: configuration.data.installedAt }
  }
}

/** Accept only Google's downloaded Desktop credentials for the reviewed Kun client. */
export function parseDownloadedGmailOAuthClient(value: unknown): string {
  const input = z.object({ installed: z.object({ client_id: z.literal(KUN_GMAIL_CLIENT_ID), client_secret: Secret,
    project_id: z.literal('kunagent-510206').optional(),
    auth_uri: z.literal('https://accounts.google.com/o/oauth2/auth').optional(),
    token_uri: z.literal('https://oauth2.googleapis.com/token').optional(),
    auth_provider_x509_cert_url: z.literal('https://www.googleapis.com/oauth2/v1/certs').optional(),
    redirect_uris: z.array(z.literal('http://localhost')).optional() }).strict() }).strict().safeParse(value)
  if (!input.success) throw invalidConfiguration()
  return input.data.installed.client_secret
}

function invalidConfiguration(): GmailError {
  return new GmailError('client_configuration_invalid', 'Use the Client Secret for the reviewed Kun Desktop OAuth client; Web clients and other client IDs are not accepted')
}
function configurationUnavailable(): GmailError {
  return new GmailError('client_configuration_unavailable', 'The encrypted Kun Desktop OAuth client configuration is unavailable. Close Kun and install its Client Secret with the local operator command')
}
