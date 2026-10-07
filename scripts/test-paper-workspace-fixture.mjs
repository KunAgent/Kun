// Supplemental DOM wiring test only: no screenshots or native desktop claims.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({ entryPoints: [resolve(root, 'scripts/fixtures/paper-workspace-ui.tsx')],
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/paper-workspace-dom',
  alias: { '@shared': resolve(root, 'src/shared'), '@renderer': resolve(root, 'src/renderer/src'),
    '@kun/provider-catalog': resolve(root, 'packages/provider-catalog/src/index.ts'), '@kun/extension-api': resolve(root, 'packages/extension-api/src/index.ts') },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'english-locale-registry', setup(builder) {
    // English resources still use production imports; Vite's lazy foreign-locale glob is not needed by this DOM-only test.
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
window.addEventListener('error', event => errors.push(event.message))
window.eval(result.outputFiles.find(file => file.path.endsWith('.js')).text)
const wait = async (condition, label) => {
  await new Promise(resolve => setTimeout(resolve, 30))
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (condition()) return
    if (errors.length) throw Error(errors.join('\n'))
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error('Timed out: ' + label + '\n' + window.document.body.textContent)
}
try {
  await wait(() => window.paperWorkspaceFixture?.ready, 'production fixture ready')
  const fixture = window.paperWorkspaceFixture
  const roots = fixture.roots
  assert.equal(fixture.snapshot().activeFile, roots.docs + '/notes.md')
  window.document.querySelector('[role=switch]').click()
  await wait(() => fixture.snapshot().root === roots.default && window.document.querySelector('[data-testid=paper-empty-import]'), 'automatic first entry')
  assert.equal(fixture.calls.picker, 0)
  assert.deepEqual(Array.from(fixture.snapshot().libraries), [roots.default])
  window.document.querySelector('[data-testid=paper-empty-import]').click()
  assert.equal(fixture.snapshot().importOpen, true)
  fixture.closeImport()
  window.document.querySelector('[data-testid=paper-empty-search]').click()
  assert.equal(fixture.snapshot().view, 'discover:search')
  await wait(() => window.document.querySelector('[data-testid=paper-research-empty] textarea'), 'actual research composer')
  fixture.openView('library')
  await wait(() => window.document.querySelector('[data-testid=paper-workspace-add]'), 'return from research')
  fixture.setPicker()
  window.document.querySelector('[data-testid=paper-workspace-add]').click()
  await wait(() => fixture.calls.picker === 1 && window.document.querySelector('[data-testid=paper-workspace-add]')?.disabled === false, 'cancel picker')
  assert.equal(fixture.snapshot().root, roots.default)
  fixture.setPicker(roots.custom)
  window.document.querySelector('[data-testid=paper-workspace-add]').click()
  await wait(() => fixture.snapshot().root === roots.custom && window.document.querySelector('[data-testid=paper-workspace-add]')?.disabled === false, 'add custom workspace')
  fixture.setSelection()
  await fixture.switch(roots.default)
  assert.equal(fixture.snapshot().root, roots.default)
  assert.deepEqual(Array.from(fixture.snapshot().selection), [])
  fixture.setFault(roots.custom, 'Permission denied (offline fixture)')
  assert.equal((await fixture.switch(roots.custom)).ok, false)
  assert.equal(fixture.snapshot().root, roots.default)
  fixture.setFault(roots.custom, null)
  await fixture.openNote()
  assert.equal(fixture.snapshot().activeFile, roots.default + '/papers/shared/NOTES.md')
  fixture.makeDirty()
  let confirmations = 0
  window.confirm = () => { confirmations++; return false }
  assert.equal((await fixture.switch(roots.custom)).ok, false)
  assert.equal(fixture.snapshot().root, roots.default)
  assert.equal(confirmations, 2)
  window.confirm = () => true
  await fixture.exit()
  assert.equal(fixture.snapshot().root, roots.docs)
  assert.equal(fixture.snapshot().activeFile, roots.docs + '/notes.md')
  await fixture.enter()
  assert.equal(fixture.snapshot().activeFile, roots.default + '/papers/shared/NOTES.md')
  for (const code of ['missing-root', 'permission-denied']) {
    fixture.setEnsureFailure(code)
    await fixture.reloadSettings()
    await wait(() => window.document.querySelector('[data-testid=paper-workspace-recovery]'), code + ' recovery')
    assert.equal(fixture.snapshot().settings.write.paperMode.activeLibrary, roots.default)
    fixture.setEnsureFailure(null)
    await fixture.reloadSettings()
    await wait(() => window.document.querySelector('[data-testid=paper-workspace-header]'), 'recovery retry')
  }
  assert.deepEqual(Array.from(fixture.snapshot().threadScopes[roots.docs]), ['docs-thread'])
  assert.deepEqual(Array.from(fixture.snapshot().threadScopes[roots.default]), ['default-paper-thread'])
  assert.deepEqual(Array.from(fixture.snapshot().threadScopes[roots.custom]), ['custom-paper-thread'])
  assert.equal(fixture.calls.runtime, 0)
  assert.deepEqual(errors, [])
  console.log('PASS supplemental DOM wiring: first entry, real buttons, cancel/add/switch, permission admission, docs/paper layouts, recovery. Native Electron screenshots NOT exercised.')
} finally { window.close() }
