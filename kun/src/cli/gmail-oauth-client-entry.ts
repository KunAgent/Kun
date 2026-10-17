import { Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createOwnedServiceManagerSession } from '../manager/owned-service-manager-session.js'
import { bindRuntimeManagerDataPlane } from '../manager/owned-manager-binding.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { createSecretEncryptor, defaultSecretCommandRunner, hasPersistedSecretKeyMaterial } from '../security/secret-store.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { EncryptedGmailOAuthClientStore, parseDownloadedGmailOAuthClient } from '../gmail/oauth-client-config.js'

/** Operator-only setup. No HTTP, IPC, model tool, environment, or secret argv setter. */
export async function installGmailOAuthClient(input: {
  dataDir: string; controlDir?: string; settingsPath?: string;
  readSecret: () => Promise<string>
}): Promise<{ clientId: string; installedAt: string }> {
  const owner = createOwnedServiceManagerSession({ ownerKind: 'cli' })
  try {
    const manager = await owner.ensure({ dataDir: resolve(input.dataDir), controlDir: input.controlDir,
      settingsPath: input.settingsPath, flavor: 'development', allowDevelopmentBootstrap: true })
    const options = { dataDir: manager.discovery.dataDir }
    bindRuntimeManagerDataPlane(options, manager)
    await assertEncryptedGmailStorage(options.dataDir)
    const keyProvider = await createSecretEncryptor({ keyFilePath: join(options.dataDir, 'secret.key'),
      run: defaultSecretCommandRunner,
      canBootstrapKeyFileFallback: async () => !await hasPersistedSecretKeyMaterial(options.dataDir) })
    const secret = await input.readSecret()
    return await new EncryptedGmailOAuthClientStore(options.dataDir, keyProvider.encryptor).install(secret)
  } finally {
    try { await owner.close() } finally { configureManagerAtomicJsonClient(null) }
  }
}

/** No terminal output receives typed/pasted secret characters. Non-TTY stdin is bounded. */
export async function readHiddenGmailClientSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = ''
    for await (const chunk of process.stdin) {
      text += String(chunk)
      if (Buffer.byteLength(text) > 2_048) throw new Error('Client Secret input is too large')
    }
    return text.trim()
  }
  process.stderr.write('Paste the Kun Desktop OAuth Client Secret (hidden), then press Enter: ')
  const hidden = new Writable({ write(_chunk, _encoding, done) { done() } })
  const reader = createInterface({ input: process.stdin, output: hidden, terminal: true })
  try {
    return await new Promise<string>((resolveValue, reject) => {
      reader.once('SIGINT', () => reject(new Error('Client Secret installation cancelled')))
      reader.once('close', () => reject(new Error('Client Secret input was closed')))
      reader.question('', (answer) => resolveValue(answer.trim()))
    })
  } finally { reader.close(); process.stderr.write('\n') }
}

export async function readDownloadedGmailClientSecret(path: string): Promise<string> {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > 16_384) throw new Error('Invalid Desktop credentials file')
    const buffer = Buffer.alloc(16_385)
    let length = 0
    while (length < buffer.length) {
      const chunk = await file.read(buffer, length, buffer.length - length, null)
      if (chunk.bytesRead === 0) break
      length += chunk.bytesRead
    }
    if (length > 16_384) throw new Error('Invalid Desktop credentials file')
    return parseDownloadedGmailOAuthClient(JSON.parse(buffer.subarray(0, length).toString('utf8')))
  } finally { await file.close() }
}

if (process.argv[1]?.endsWith('gmail-oauth-client-entry.js')) {
  void (async () => {
    const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, 'control-dir': { type: 'string' },
      'settings-path': { type: 'string' }, 'client-json': { type: 'string' } }, strict: true })
    if (!values['data-dir']) throw new Error('A canonical data directory is required')
    const result = await installGmailOAuthClient({ dataDir: values['data-dir'], controlDir: values['control-dir'],
      settingsPath: values['settings-path'], readSecret: values['client-json']
        ? () => readDownloadedGmailClientSecret(values['client-json']!) : readHiddenGmailClientSecret })
    console.log(`Kun Desktop OAuth configuration saved encrypted for ${result.clientId}. Reopen Kun.`)
  })().catch(() => {
    console.error('OAuth configuration was not installed. Close Kun, use the reviewed Kun Desktop client, and retry. No credential was logged.')
    process.exitCode = 1
  })
}
