const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

// Isolated test profile, own-renderer video only, in-memory input sink. No OS input or user screen.
const root = resolve(__dirname, '..'), temporary = mkdtempSync(join(tmpdir(), 'kun-computer-desktop-'))
async function main() {
  try {
    mkdirSync(join(temporary, 'out/preload'), { recursive: true })
    mkdirSync(join(temporary, 'out/renderer'), { recursive: true })
    mkdirSync(join(temporary, 'resources/native'), { recursive: true })
    for (const name of ['remote-desktop-capture', 'remote-desktop-indicator']) copyFileSync(join(root,'out/preload',name+'.cjs'),join(temporary,'out/preload',name+'.cjs'))
    cpSync(join(root,'node_modules/@kun/control-runtime/baselines/darwin-arm64'),join(temporary,'control'),{recursive:true})
    copyFileSync(join(root,'resources/native/remote-desktop-input'),join(temporary,'resources/native/remote-desktop-input'))
    writeFileSync(join(temporary,'package.json'),JSON.stringify({name:'kun-computer-desktop-fixture',version:'1.0.0',main:'main.cjs'}))
    writeFileSync(join(temporary,'receiver.html'),'<!doctype html><meta charset="utf-8"><title>Computer desktop fixture</title><video autoplay muted width="640" height="400"></video><script src="receiver.js"></script>')
    writeFileSync(join(temporary,'receiver-preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{
      invoke:(method,params)=>ipcRenderer.invoke('fixture:invoke',method,params),
      events:listener=>{const f=(_,value)=>listener(value);ipcRenderer.on('fixture:event',f);return()=>ipcRenderer.removeListener('fixture:event',f)},
      stats:()=>ipcRenderer.invoke('fixture:stats'),complete:value=>ipcRenderer.send('fixture:complete',value),fail:value=>ipcRenderer.send('fixture:fail',value)
    })`)
    await build({entryPoints:[join(__dirname,'fixtures/computer-desktop-main.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:join(temporary,'main.cjs')})
    await build({entryPoints:[join(__dirname,'fixtures/computer-desktop-receiver.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome128',outfile:join(temporary,'receiver.js')})
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
    const result=spawnSync(require('electron'),[temporary],{env,encoding:'utf8',timeout:40000})
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'')
    if(result.error)throw result.error
    assert.equal(result.status,0,'Computer desktop media/control smoke failed')
    assert.ok(result.stdout.includes('"computerDesktop":true'),'Missing completion evidence')
  } finally { rmSync(temporary,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
