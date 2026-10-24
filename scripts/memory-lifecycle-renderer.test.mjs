import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildMemoryLifecycleRenderer } from './memory-lifecycle-renderer.mjs'

test('native memory fixture bundles the real PDF worker URL as a local asset', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'kun-memory-bundle-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const compiled = await buildMemoryLifecycleRenderer(temporary)
  const worker = compiled.outputFiles.find(file => /pdf\.worker-[^/\\]+\.mjs$/.test(file.path))
  assert.ok(worker, 'Vite ?url imports must emit the real worker, not a stub or remote URL')
  const require = createRequire(import.meta.url)
  assert.deepEqual(Buffer.from(worker.contents), await readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs')))
  const javascript = compiled.outputFiles.find(file => file.path.endsWith('.js')).text
  assert.match(javascript, /\.\/assets\/pdf\.worker-[^"\s]+\.mjs/)
  assert.doesNotMatch(javascript, /pdf\.worker\.mjs\?url/)
})
