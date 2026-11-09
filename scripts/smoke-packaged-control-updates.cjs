const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1] }
const app = option('--app')
assert.ok(app, 'Usage: smoke-packaged-control-updates --app /path/Kun.app')
const temporary = mkdtempSync(join(tmpdir(), 'kun-packaged-control-update-'))
async function main() {
  try {
    await build({ entryPoints: [join(__dirname, 'fixtures/control-update-main.ts')], bundle: true, platform: 'node', format: 'cjs',
      external: ['electron'], outfile: join(temporary, 'main.cjs') })
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ name: 'kun-control-update-verification', version: '1.0.0', main: 'main.cjs' }))
    const env = { ...process.env, KUN_CONTROL_TEST_RESOURCES: join(resolve(app), 'Contents/Resources'), KUN_CONTROL_TEST_HOME: temporary }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [temporary], { env, encoding: 'utf8', timeout: 200000 })
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, result.error?.message || 'Packaged control update verification failed')
    assert.match(result.stdout, /"parallelTaskSurvived":true/)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
