const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

// Isolated test profile, own-renderer video only, in-memory input sink. No OS input or user screen.
const durationIndex = process.argv.indexOf('--measure-seconds')
const duration = durationIndex < 0 ? 0 : Number(process.argv[durationIndex + 1])
if (!Number.isInteger(duration) || durationIndex >= 0 && (duration < 10 || duration > 600)) throw Error('Use 10–600 seconds for the motion test')
const dropConnection = process.argv.includes('--privacy-drop')
const privacy = dropConnection || process.argv.includes('--privacy')
const windowsPrivacy = privacy && process.platform === 'win32'
if (windowsPrivacy) assert.ok(process.argv.includes('--disposable-windows-desktop'), 'The Windows display smoke needs a dedicated disposable desktop')
const requireGameTarget = process.argv.includes('--require-game-target')
const testFullscreen = process.argv.includes('--viewer-fullscreen')
const testRelay = process.argv.includes('--viewer-relay')
const testViewer = testFullscreen || testRelay || process.argv.includes('--viewer')
const controlIndex = process.argv.indexOf('--control-dir')
const turnPort = Number(process.env.KUN_FIXTURE_TURN_PORT || 0)
assert.ok(Number.isInteger(turnPort) && turnPort >= 0 && turnPort <= 65535, 'Invalid local TURN fixture port')
if (testRelay) assert.ok(turnPort, 'Set KUN_FIXTURE_TURN_PORT to the loopback test relay port')
if (requireGameTarget && duration !== 600) throw Error('The presentation gate requires --measure-seconds 600')
const root = resolve(__dirname, '..'), temporary = mkdtempSync(join(tmpdir(), 'kun-computer-desktop-'))
async function main() {
  try {
    mkdirSync(join(temporary, 'out/preload'), { recursive: true })
    mkdirSync(join(temporary, 'out/renderer'), { recursive: true })
    mkdirSync(join(temporary, 'resources/native'), { recursive: true })
    if (windowsPrivacy && !existsSync(join(root, 'out/preload/remote-desktop-capture.cjs'))) {
      await build({ entryPoints: [join(root, 'src/preload/remote-desktop-capture.ts')], bundle: true, platform: 'node',
        format: 'cjs', external: ['electron'], outfile: join(temporary, 'out/preload/remote-desktop-capture.cjs') })
    } else {
      const preloads = windowsPrivacy ? ['remote-desktop-capture'] : ['remote-desktop-capture', 'remote-desktop-indicator']
      for (const name of preloads) copyFileSync(join(root,'out/preload',name+'.cjs'),join(temporary,'out/preload',name+'.cjs'))
    }
    const control = controlIndex < 0 ? join(root,'node_modules/@kun/control-runtime/baselines',process.platform+'-'+process.arch) : resolve(process.argv[controlIndex + 1])
    cpSync(control, join(temporary,'control'), { recursive: true })
    const helper = process.platform === 'linux' ? 'linux-desktop' : process.platform === 'win32' ? 'remote-desktop-input.exe' : 'remote-desktop-input'
    cpSync(join(root,'resources/native',helper),join(temporary,'resources/native',helper),{recursive:true})
    if (windowsPrivacy) {
      const compiler = spawnSync('go', ['test', '-c', '-o', join(temporary, 'privacy-windows-test.exe'), '.'],
        { cwd: join(root, 'native/remote-desktop/windows'), stdio: 'inherit' })
      assert.equal(compiler.status, 0)
    } else if (privacy) {
      assert.equal(process.platform, 'darwin')
      assert.ok(parseInt(require('node:os').release(), 10) >= 23, 'The synthetic pixel probe needs macOS 14 or later')
      const target = join(temporary, 'resources/native', helper)
      copyFileSync(target, target + '.shipped')
      const compiler = spawnSync('xcrun', ['clang', '-fobjc-arc', '-fmodules', '-O2', '-DKUN_PRIVACY_TEST_DISPLAY',
        join(root, 'native/remote-desktop/macos-privacy-screen.m'), join(__dirname, 'fixtures/mac-privacy-probe.m'),
        '-framework', 'AppKit', '-framework', 'Carbon', '-framework', 'CoreGraphics', '-framework', 'CoreMedia',
        '-framework', 'CoreVideo', '-framework', 'QuartzCore', '-framework', 'ScreenCaptureKit', '-o', target], { stdio: 'inherit' })
      assert.equal(compiler.status, 0)
      // A separate observer identity avoids interrupting the helper's ScreenCaptureKit connection.
      const observer = join(temporary, 'PixelProbe.app/Contents')
      mkdirSync(join(observer, 'MacOS'), { recursive: true })
      writeFileSync(join(observer, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.kun.test.privacy-pixel</string><key>CFBundleExecutable</key><string>PixelProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>')
      copyFileSync(target, join(observer, 'MacOS/PixelProbe'))
    }
    writeFileSync(join(temporary,'package.json'),JSON.stringify({name:'kun-computer-desktop-fixture',version:'1.0.0',main:'main.cjs'}))
    writeFileSync(join(temporary,'receiver.html'),'<!doctype html><meta charset="utf-8"><title>Computer desktop fixture</title><video autoplay muted width="640" height="400"></video><script src="receiver.js"></script>')
    if (testViewer) {
      copyFileSync(join(root, 'out/preload/remote-desktop-viewer.cjs'), join(temporary, 'receiver-preload.cjs'))
    } else writeFileSync(join(temporary,'receiver-preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{
      invoke:(method,params)=>ipcRenderer.invoke('fixture:invoke',method,params),
      events:listener=>{const f=(_,value)=>listener(value);ipcRenderer.on('fixture:event',f);return()=>ipcRenderer.removeListener('fixture:event',f)},
      privacy:${privacy},dropConnection:${dropConnection},localColor:value=>ipcRenderer.invoke('fixture:local-color',value),
      measureSeconds:${duration},gaming:${Boolean(duration || process.argv.includes('--game'))},senderStats:()=>ipcRenderer.invoke('fixture:sender-stats'),stats:()=>ipcRenderer.invoke('fixture:stats'),complete:value=>ipcRenderer.send('fixture:complete',value),fail:value=>ipcRenderer.send('fixture:fail',value)
    })`)
    await build({entryPoints:[join(__dirname,'fixtures/computer-desktop-main.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:join(temporary,'main.cjs')})
    await build({entryPoints:[join(__dirname,'fixtures/computer-desktop-receiver.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome128',outfile:join(temporary,'receiver.js')})
    const env={...process.env,KUN_FIXTURE_DISPOSABLE_WINDOWS:windowsPrivacy?'1':'0',KUN_FIXTURE_PRIVACY:privacy?'1':'0',KUN_FIXTURE_SECONDS:String(duration),KUN_FIXTURE_VIEWER:testViewer?'1':'0',KUN_FIXTURE_FULLSCREEN:testFullscreen?'1':'0',KUN_FIXTURE_RELAY:testRelay?'1':'0',KUN_FIXTURE_GAME:(duration||testViewer||process.argv.includes('--game'))?'1':'0',KUN_FIXTURE_PORTAL:process.argv.includes('--portal')?'1':'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
    const result=spawnSync(require('electron'),[temporary],{env,encoding:'utf8',timeout:duration*1000+(testViewer?60000:40000)})
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'')
    if(result.error)throw result.error
    assert.equal(result.status,0,'Computer desktop media/control smoke failed')
    assert.ok(result.stdout.includes('"computerDesktop":true'),'Missing completion evidence')
    if (requireGameTarget) {
      const row = result.stdout.split('\n').find(line => line.startsWith('{"computerDesktop":true'))
      const measurement = JSON.parse(row).measurement
      assert.ok(measurement.fullHdRenderedFps >= 58, '1080p presented ' + measurement.fullHdRenderedFps.toFixed(2) + ' fps; release target is 58')
    }
  } finally { rmSync(temporary,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
