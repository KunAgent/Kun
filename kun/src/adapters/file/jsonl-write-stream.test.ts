import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { writeJsonlLines } from './jsonl-write-stream.js'

describe('writeJsonlLines', () => {
  it('rejects an asynchronous writer error after write accepts a record', async () => {
    const error = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    const writer = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
        queueMicrotask(() => writer.emit('error', error))
      }
    })

    await expect(writeJsonlLines('/ignored.jsonl', (async function* () {
      yield '{"kind":"event"}\n'
    })(), { createWriteStream: () => writer })).rejects.toBe(error)
  })
})
