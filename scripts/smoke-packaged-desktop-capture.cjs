const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve, dirname } = require('node:path')
const { build } = require('esbuild')
const asar = require('@electron/asar')

// Hidden host + receiver, using real shipped capture/preload assets and native guard.
// The only video source is an animated fixture frame, never the user's desktop.
assert.equal(process.platform, 'darwin', 'Native desktop guard smoke requires macOS')
assert.equal(process.arch, 'arm64', 'Native desktop guard smoke requires Apple Silicon')
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const app = option('--app')
assert.ok(app, 'Usage: node scripts/smoke-packaged-desktop-capture.cjs --app /path/Kun.app [--baseline-capture-host file]')
const baseline = option('--baseline-capture-host')
const controlDirectory = option('--control-directory')
const archive = join(resolve(app), 'Contents/Resources/app.asar')
const temporary = mkdtempSync(join(tmpdir(), 'kun-packaged-capture-'))
const repository = resolve(__dirname, '..')
function write(relative, data) { const path = join(temporary, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data) }
async function main() { try {
  for (const name of ['remote-desktop-capture', 'remote-desktop-indicator'])
    write(`out/preload/${name}.cjs`, asar.extractFile(archive, `out/preload/${name}.cjs`))
  if (!controlDirectory) {
    const html = asar.extractFile(archive, 'out/renderer/remote-desktop-capture.html')
    const asset = /\.\/assets\/remote-desktop-capture-[^"']+\.js/.exec(html.toString())?.[0]
    assert.ok(asset, 'Pass --control-directory for clients without a bundled control package')
    write('out/renderer/remote-desktop-capture.html', html)
    write('out/renderer/' + asset.slice(2), asar.extractFile(archive, 'out/renderer/' + asset.slice(2)))
  }
  write('package.json', JSON.stringify({ name: 'kun-packaged-capture-fixture', version: '1.0.0', main: 'out/main/chunks/smoke.cjs' }))
  write('receiver.html', '<!doctype html><title>Kun synthetic receiver</title><video autoplay muted></video>')
  write('receiver-preload.cjs', "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{candidate:value=>ipcRenderer.send('fixture:ice',value)})")
  mkdirSync(join(temporary, 'resources/native'), { recursive: true })
  copyFileSync(join(resolve(app), 'Contents/Resources/native/remote-desktop-input'), join(temporary, 'resources/native/remote-desktop-input'))
  chmodSync(join(temporary, 'resources/native/remote-desktop-input'), 0o755)
  await build({ entryPoints: [join(__dirname, 'fixtures/desktop-capture-main.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(temporary, 'out/main/chunks/smoke.cjs'),
    ...(baseline ? { plugins: [{ name: 'old-capture-path', setup(builder) {
      builder.onLoad({ filter: /\/remote-desktop\/capture-host\.ts$/ }, () => ({ contents: readFileSync(resolve(baseline), 'utf8'), loader: 'ts', resolveDir: join(repository, 'src/main/remote-desktop') }))
    } }] } : {}) })
  const env = { ...process.env, KUN_CAPTURE_EXPECT_LOAD_FAILURE: baseline ? '1' : '0', KUN_CAPTURE_USE_CONTROL_PROCESS: process.argv.includes('--control-process') ? '1' : '0', ...(controlDirectory ? { KUN_CAPTURE_CONTROL_DIRECTORY: resolve(controlDirectory) } : {}) }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const result = spawnSync(require('electron'), [temporary], { env, encoding: 'utf8', timeout: 40000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) throw result.error
  assert.equal(result.status, 0, 'Packaged capture pipeline smoke failed')
  assert.ok((result.stdout || '').includes(baseline ? '"baselineRejected":true' : '"hostCleanupConfirmed":true'), 'Missing completion evidence')
} finally { rmSync(temporary, { recursive: true, force: true }) } }
main().catch(error => { console.error(error.message); process.exitCode = 1 })
