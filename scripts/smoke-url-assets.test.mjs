import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { smokeUrlAssets, writeSmokeAssets } from './smoke-url-assets.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

test('emits the real PDF worker as an asset URL without requiring a default export', async () => {
  const output = await mkdtemp(join(tmpdir(), 'kun-smoke-url-'))
  try {
    const compiled = await build({
      stdin: { contents: "import worker from 'pdfjs-dist/build/pdf.worker.mjs?url'; export default worker", resolveDir: root },
      bundle: true, platform: 'browser', format: 'esm', write: false,
      outdir: output, assetNames: 'assets/[name]-[hash]', plugins: [smokeUrlAssets()]
    })
    await writeSmokeAssets(compiled.outputFiles)
    const javascript = compiled.outputFiles.find(file => file.path.endsWith('.js')).text
    const { default: workerUrl } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
    assert.match(workerUrl, /^\.\/assets\/pdf\.worker-.*\.mjs$/)
    assert.deepEqual(await readFile(join(output, workerUrl)), await readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs')))
    assert.ok(!javascript.includes('WorkerMessageHandler'), 'worker source must not be evaluated in the renderer bundle')
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('resolves relative URL assets and reports missing assets instead of substituting a stub', async () => {
  const output = await mkdtemp(join(tmpdir(), 'kun-smoke-url-'))
  try {
    const source = "throw new Error('asset source must not run')"
    await writeFile(join(output, 'worker.mjs'), source)
    const options = {
      stdin: { contents: "import url from './worker.mjs?url'; export default url", resolveDir: output },
      bundle: true, format: 'esm', write: false, outdir: join(output, 'built'), plugins: [smokeUrlAssets()]
    }
    const compiled = await build(options)
    await writeSmokeAssets(compiled.outputFiles)
    const javascript = compiled.outputFiles.find(file => file.path.endsWith('.js')).text
    const { default: url } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
    assert.equal(await readFile(join(output, 'built', url), 'utf8'), source)
    await assert.rejects(build({ ...options, logLevel: 'silent', stdin: {
      contents: "import './missing.mjs?url'", resolveDir: output
    } }), /Could not resolve/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
