import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const OWNER = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Per-account record that the user left the Kun iOS relay on. It sits next to that account's device identity;
 * an explicit stop, sign-out or account switch deletes it. It holds no credential.
 */
export class RelayPreference {
  constructor(private root: string) {}
  private file(owner: string) {
    if (!OWNER.test(owner)) throw new Error('INVALID_OWNER')
    return join(this.root, owner, 'relay.json')
  }
  async remembered(owner: string): Promise<boolean> {
    try {
      return JSON.parse(await readFile(this.file(owner), 'utf8'))?.enabled === true
    } catch {
      return false
    }
  }
  async remember(owner: string) {
    const file = this.file(owner), temporary = file + '.' + randomUUID() + '.tmp'
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(temporary, JSON.stringify({ enabled: true }) + '\n', { mode: 0o600 })
    await rename(temporary, file)
  }
  async forget(owner: string) {
    await rm(this.file(owner), { force: true })
  }
}
