import { createHash } from 'node:crypto'

/** Cache identity survives handle expiry; it grants no filesystem access. */
export function projectFileIdentity(hostDataDir: string, projectId: string, rootIdentity: string, path: string) {
  return 'file_' + createHash('sha256').update(JSON.stringify([
    hostDataDir, projectId, rootIdentity, path
  ])).digest('hex')
}
