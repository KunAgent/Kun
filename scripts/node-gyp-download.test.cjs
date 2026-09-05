'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const test = require('node:test')

// Exercise node-gyp's actual download stack in isolation: an uncaught parser
// assertion must fail this test without terminating the rest of the test suite.
// Regression: https://github.com/nodejs/undici/issues/5360
test('node-gyp consumes a complete download after backpressure and socket EOF', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict')
    const { createServer } = require('node:net')
    const { download } = require('node-gyp/lib/download.js')
    const body = Buffer.alloc(64 * 1024, 97)
    const server = createServer(socket => {
      socket.once('data', () => socket.end(Buffer.concat([
        Buffer.from('HTTP/1.1 200 OK\\r\\nContent-Length: ' + body.length +
          '\\r\\nConnection: close\\r\\n\\r\\n'),
        body
      ])))
    })
    server.listen(0, '127.0.0.1', async () => {
      try {
        const response = await download({ version: 'test', opts: {} },
          'http://127.0.0.1:' + server.address().port + '/headers.tar.gz')
        assert.equal(response.status, 200)
        // Let the body pause the parser before the peer's FIN is processed.
        await new Promise(resolve => setTimeout(resolve, 200))
        const chunks = []
        for await (const chunk of response.body) chunks.push(chunk)
        assert.deepEqual(Buffer.concat(chunks), body)
      } catch (error) {
        console.error(error)
        process.exitCode = 1
      } finally {
        server.close()
      }
    })
  `], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NO_PROXY: '*', no_proxy: '*' }
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
