import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createMathRenderingServer } from './math-rendering-server.mjs'

// Exercise the actual fixture/dependency graph, not a mocked Vite config.
// Cold startup must finish all bundling before any browser can request assets.
test('math fixture serves stable built assets without a dev optimizer', { timeout: 180_000 }, async () => {
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(join(repository, 'node_modules/.kun-math-server-test-'))
  let server
  try {
    server = await createMathRenderingServer(repository, temporary)
    const origin = server.resolvedUrls.local[0]
    const html = await (await fetch(origin)).text()
    assert.match(html, /\/assets\/[^" ]+\.js/)
    assert.doesNotMatch(html, /@vite\/client|fixture\.tsx|vite-cache|\/deps\//)
    const assets = await readdir(join(temporary, 'dist/assets'))
    assert.ok(assets.some(name => name.endsWith('.css')), 'production styles must be bundled')
    assert.ok(assets.some(name => name.endsWith('.woff2')), 'local math fonts must be emitted')
    // Fetch every emitted asset twice, retaining the original URLs. No late
    // dependency discovery may remove an earlier generation's shared chunks.
    for (let pass = 0; pass < 2; pass++) {
      for (const name of assets) {
        const response = await fetch(new URL(`assets/${name}`, origin))
        assert.equal(response.status, 200, name)
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(temporary, 'dist/assets', name)), name)
      }
      assert.equal(await (await fetch(origin)).text(), html)
    }
  } finally {
    await server?.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
