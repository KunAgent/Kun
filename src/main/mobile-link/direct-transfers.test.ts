import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { DirectTransfers } from './direct-transfers'
it('expires abandoned scratch sessions while preserving recent sessions and unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-cleanup-')), old = join(root, randomUUID()), recent = join(root, randomUUID()), unrelated = join(root, 'keep')
  try {
    for (const path of [old, recent, unrelated]) { await mkdir(path); await writeFile(join(path, 'value'), 'kept') }
    await utimes(old, new Date(0), new Date(0)); await utimes(unrelated, new Date(0), new Date(0))
    await DirectTransfers.pruneAbandoned(root)
    await expect(readFile(join(old, 'value'))).rejects.toThrow()
    expect(await readFile(join(recent, 'value'), 'utf8')).toBe('kept')
    expect(await readFile(join(unrelated, 'value'), 'utf8')).toBe('kept')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('downloads only completed host files to their intended phone and denies other phones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-download-')), transfers = new DirectTransfers(root, 'host')
  const data = Buffer.from('private file'), sha256 = createHash('sha256').update(data).digest('hex')
  try {
    const value = await transfers.request('phone', 'host', '/transfers', 'POST', { recipientId: 'phone', size: data.length, sha256 })
    await expect(transfers.request('other', 'phone', '/transfers/' + value.id, 'GET')).rejects.toThrow('FILE_UNAVAILABLE')
    await expect(transfers.request('phone', 'phone', '/transfers/' + value.id + '/chunk', 'POST', { offset: 0 })).rejects.toThrow('INVALID_TRANSFER')
    await transfers.request('phone', 'host', '/transfers/' + value.id + '/content', 'PUT', data)
    const chunk = await transfers.request('phone', 'phone', '/transfers/' + value.id + '/chunk', 'POST', { offset: 0 })
    expect(Buffer.from(chunk.data, 'base64').toString()).toBe('private file')
    await transfers.request('phone', 'phone', '/transfers/' + value.id + '/received', 'POST')
    await expect(transfers.request('phone', 'phone', '/transfers/' + value.id, 'GET')).rejects.toThrow('FILE_UNAVAILABLE')
  } finally { await transfers.stop() }
})
