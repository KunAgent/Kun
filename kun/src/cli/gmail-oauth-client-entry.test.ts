import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { KUN_GMAIL_CLIENT_ID } from '../gmail/ports.js'

const manager = vi.hoisted(() => ({ ensure: vi.fn(), close: vi.fn(async () => undefined) }))
vi.mock('../manager/owned-service-manager-session.js', () => ({ createOwnedServiceManagerSession: () => manager }))
import { installGmailOAuthClient, readDownloadedGmailClientSecret } from './gmail-oauth-client-entry.js'

describe('operator-only Desktop OAuth installer', () => {
  it('does not ask for credentials when another application owns the data directory', async () => {
    manager.ensure.mockRejectedValueOnce(new Error('Application session is owned'))
    const readSecret = vi.fn(async () => 'fake-desktop-secret')
    await expect(installGmailOAuthClient({ dataDir: '/tmp/kun-owned-data', readSecret })).rejects.toThrow('Application session is owned')
    expect(readSecret).not.toHaveBeenCalled()
    expect(manager.close).toHaveBeenCalledOnce()
  })

  it('reads bounded regular downloaded JSON without following a substituted symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-gmail-config-import-'))
    const file = join(directory, 'desktop.json')
    try {
      await writeFile(file, JSON.stringify({ installed: { client_id: KUN_GMAIL_CLIENT_ID, client_secret: 'fake-desktop-secret' } }))
      expect(await readDownloadedGmailClientSecret(file)).toBe('fake-desktop-secret')
      await symlink(file, join(directory, 'redirect.json'))
      await expect(readDownloadedGmailClientSecret(join(directory, 'redirect.json'))).rejects.toThrow()
      await writeFile(file, ' '.repeat(16_385))
      await expect(readDownloadedGmailClientSecret(file)).rejects.toThrow('Invalid Desktop credentials file')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
