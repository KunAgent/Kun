const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const asar = require('@electron/asar')
const index = process.argv.indexOf('--app')
assert.ok(index >= 0, 'Usage: smoke-packaged-control-bootstrap --app /path/Kun.app')
const resources = join(resolve(process.argv[index + 1]), 'Contents/Resources')
const archive = join(resources, 'app.asar')
const files = asar.listPackage(archive)
assert.ok(!files.some(file => /\.tgz$|node_modules\/@kun\/control-runtime\/|control-baselines\//.test(file)), 'Payload or source archives leaked into the client')
assert.equal(existsSync(join(resources, 'control-baselines')), false)
const temporary = mkdtempSync(join(tmpdir(), 'kun-control-bootstrap-'))
async function main() {
  try {
    mkdirSync(join(temporary, 'out/preload'), {recursive: true})
    writeFileSync(join(temporary, 'out/preload/control-viewer-probe.cjs'), asar.extractFile(archive, 'out/preload/control-viewer-probe.cjs'))
    await build({entryPoints: [join(__dirname, 'fixtures/control-bootstrap-main.ts')], bundle: true, platform: 'node', format: 'cjs',
      external: ['electron'], outfile: join(temporary, 'main.cjs')})
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({name: 'kun-control-bootstrap-fixture', version: '1.0.0', main: 'main.cjs'}))
    const env = {...process.env, KUN_CONTROL_BOOTSTRAP_RESOURCES: resources, KUN_CONTROL_BOOTSTRAP_HOME: temporary}
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [temporary], {env, encoding: 'utf8', timeout: 240000})
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, result.error?.message || 'Packaged bootstrap smoke failed')
    assert.match(result.stdout, /"noBundledControl":true/)
  } finally { rmSync(temporary, {recursive: true, force: true}) }
}
main().catch(error => {console.error(error.message); process.exitCode = 1})
