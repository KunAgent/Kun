import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadPublicRelease } from './public-release-download.mjs'

const url = 'https://example.com/Kun-0.3.9-win-x64.exe'
const text = response => response.text()
const networkError = code => Object.assign(new Error('connection failed'), { code })

for (const failure of [
  new TypeError('fetch failed', { cause: new AggregateError([
    networkError('ETIMEDOUT'), networkError('ENETUNREACH')
  ]) }),
  new DOMException('Timed out', 'TimeoutError'),
  ...[408, 429, 502, 503, 504, 522].map(status => new Response('', { status }))
]) {
  test(`retries transient failure ${failure.status || failure.name}`, async () => {
    let calls = 0
    const delays = []
    const result = await downloadPublicRelease(url, text, {
      fetchResponse: async () => {
        if (++calls > 1) return new Response('complete')
        if (failure instanceof Error) throw failure
        return failure
      },
      wait: async delay => delays.push(delay), log: () => {}
    })
    assert.equal(result, 'complete')
    assert.equal(calls, 2)
    assert.deepEqual(delays, [1000])
  })
}

test('persistent network failure stops after four attempts with URL and cause', async () => {
  let calls = 0
  const delays = []
  await assert.rejects(downloadPublicRelease(url, text, {
    fetchResponse: async () => { calls++; throw networkError('ETIMEDOUT') },
    wait: async delay => delays.push(delay), log: () => {}
  }), error => {
    assert.ok(error.message.includes(url))
    assert.match(error.message, /4 attempt\(s\).*ETIMEDOUT/)
    return true
  })
  assert.equal(calls, 4)
  assert.deepEqual(delays, [1000, 2000, 4000])
})

for (const status of [401, 403, 404]) {
  test(`HTTP ${status} fails without retry`, async () => {
    let calls = 0
    await assert.rejects(downloadPublicRelease(url, text, {
      fetchResponse: async () => { calls++; return new Response('', { status }) },
      wait: async () => assert.fail('Must not retry'), log: () => {}
    }), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
  })
}

test('content validation errors do not retry', async () => {
  await assert.rejects(downloadPublicRelease(url, () => assert.fail('checksum differs'), {
    fetchResponse: async () => new Response('bad bytes'),
    wait: async () => assert.fail('Must not retry'), log: () => {}
  }), /checksum differs/)
})

test('aborts the old response before retrying a failed body read', async () => {
  let calls = 0
  let previousSignal
  const result = await downloadPublicRelease(url, text, {
    fetchResponse: async (_url, { signal }) => {
      if (++calls > 1) {
        assert.equal(previousSignal.aborted, true)
        return new Response('complete')
      }
      previousSignal = signal
      return { ok: true, text: async () => { throw networkError('UND_ERR_SOCKET') } }
    },
    wait: async () => {}, log: () => {}
  })
  assert.equal(result, 'complete')
  assert.equal(calls, 2)
})
