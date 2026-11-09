const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const root = resolve(__dirname, '..')
const index = process.argv.indexOf('--issuer')
const issuer = index < 0 ? resolve(root, '../kunserve') : resolve(process.argv[index + 1])
assert.ok(existsSync(join(issuer, 'packages/control-host/test/fixtures.mjs')), 'Pass --issuer /path/to/kunserve')
const temporary = mkdtempSync(join(tmpdir(), 'kun-control-viewer-'))
async function main() {
  try {
    mkdirSync(join(temporary, 'out/preload'), { recursive: true })
    const preload = join(root, 'out/preload/control-viewer-probe.cjs')
    assert.ok(existsSync(preload), 'Run npm run build before the viewer smoke')
    // Use the shipped build output so sandbox-incompatible Rollup chunks cannot hide behind a fixture rebuild.
    copyFileSync(preload, join(temporary, 'out/preload/control-viewer-probe.cjs'))
    await build({ entryPoints: [join(__dirname, 'fixtures/control-viewer-main.ts')], bundle: true, platform: 'node', format: 'cjs',
      external: ['electron'], outfile: join(temporary, 'main.cjs') })
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ name: 'kun-control-viewer-fixture', version: '1.0.0', main: 'main.cjs' }))
    const env = { ...process.env, KUN_VIEWER_TEST_HOME: temporary, KUN_VIEWER_ISSUER_ROOT: issuer }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [temporary], { env, encoding: 'utf8', timeout: 90000 })
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, result.error?.message || 'Control viewer smoke failed')
    assert.match(result.stdout, /"downloadedViewer":true/)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
