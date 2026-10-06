// Supplemental DOM wiring only; this produces no native screenshot evidence.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({ entryPoints: [resolve(root, 'scripts/fixtures/work-assistant-ui.tsx')],
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', conditions: ['development'], write: false, outdir: '/tmp/work-assistant-dom',
  alias: { '@shared': resolve(root, 'src/shared'), '@renderer': resolve(root, 'src/renderer/src'),
    '@kun/provider-catalog': resolve(root, 'packages/provider-catalog/src/index.ts'), '@kun/extension-api': resolve(root, 'packages/extension-api/src/index.ts') },
  loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'vite-url-assets', setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, async args => {
      const resolved = await builder.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind })
      return { path: resolved.path, namespace: 'vite-url' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'vite-url' }, async ({ path }) => ({ contents: await readFile(path), loader: 'file' }))
  } }, { name: 'english-dom-fixture', setup(builder) {
    builder.onLoad({ filter: /[/\\]i18n\.ts$/ }, async ({ path }) => ({
      contents: (await readFile(path, 'utf8')).replace(/import\.meta\.glob<LocaleModule>\([\s\S]*?\)/, '{}'), loader: 'ts'
    }))
  } }]
})
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://offline-fixture.invalid', pretendToBeVisual: true, runScripts: 'outside-only'
})
const { window } = dom
const errors = []
Object.assign(window, { structuredClone, TextEncoder, TextDecoder,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }
})
window.HTMLElement.prototype.scrollIntoView = () => {}
window.HTMLElement.prototype.scrollTo = () => {}
window.addEventListener('error', event => errors.push(event.message))
window.eval(result.outputFiles.find(file => file.path.endsWith('.js')).text)
const wait = async (condition, label) => {
  await new Promise(resolve => setTimeout(resolve, 30))
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (condition()) return
    if (errors.length) throw Error(errors.join('\n'))
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error('Timed out: ' + label + '\n' + window.document.body.textContent)
}
const button = label => [...window.document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent.trim() === label)
try {
  await wait(() => window.workAssistantFixture?.ready && window.document.querySelector('[data-presentation=page] textarea'), 'actual assistant composer')
  const fixture = window.workAssistantFixture
  assert.equal(fixture.snapshot().surface, 'assistant')
  const composer = window.document.querySelector('[data-presentation=page] textarea')
  button('Continue in sidebar').click()
  await wait(() => window.document.querySelector('[data-presentation=sidebar]'), 'docked assistant')
  assert.equal(window.document.querySelector('[data-presentation=sidebar] textarea'), composer)
  button('Open full conversation').click()
  await wait(() => window.document.querySelector('[data-presentation=page]'), 'full assistant')
  assert.equal(window.document.querySelector('[data-presentation=page] textarea'), composer)
  assert.equal(fixture.snapshot().thread, 'offline-work-session')
  fixture.openLibrary()
  await wait(() => button('Explain this view'), 'batch library action')
  button('Explain this view').click()
  await wait(() => window.document.querySelector('[data-testid=paper-batch-assistant]'), 'batch setup')
  assert.equal(fixture.snapshot().surface, 'assistant')
  assert.equal(fixture.snapshot().batch.items.length, 4)
  assert.equal(window.document.querySelector('[data-testid=paper-batch-start]').disabled, true)
  const remove = [...window.document.querySelectorAll('button')].find(item => /^Remove .* from batch$/.test(item.getAttribute('aria-label') || ''))
  remove.click()
  await wait(() => fixture.snapshot().batch.items.length === 3, 'remove selected source')
  assert.equal(fixture.snapshot().calls.model, 0)
  assert.equal(fixture.snapshot().calls.writes, 0)
  assert.deepEqual(errors, [])
  console.log('PASS supplemental DOM: real full/docked assistant keeps composer/thread; library batch staging/removal is explicit and sends nothing. Native screenshots NOT exercised.')
} finally { window.close() }
