'use strict'
// Real Electron canvas regression: hot-updated artwork must not taint PNG export.
// Run: node scripts/smoke-share-poster.cjs
const { mkdtemp, readFile, writeFile, rm, mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve, relative, isAbsolute } = require('node:path')
const root = resolve(__dirname, '..')

async function runElectron(folder) {
  const { app, BrowserWindow, ipcMain, protocol } = require('electron')
  app.setPath('userData', join(folder, 'profile'))
  const { ART_SCHEME, registerArtProtocol, bindArtResourceReader } = require(join(folder, 'protocol.cjs'))
  protocol.registerSchemesAsPrivileged([ART_SCHEME])
  await app.whenReady()
  bindArtResourceReader(async url => {
    const path = new URL(url).pathname.slice(1)
    const base = join(root, 'src/asset/img/kun-avatar')
    const file = resolve(base, path)
    const local = relative(base, file)
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('invalid fixture path')
    return readFile(file)
  })
  registerArtProtocol(protocol)
  const timer = setTimeout(() => { console.error('Poster smoke timed out'); app.exit(1) }, 60000)
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: join(folder, 'preload.cjs') } })
  ipcMain.once('poster-smoke-result', (event, result) => {
    if (event.sender !== window.webContents) return
    clearTimeout(timer)
    console.log(JSON.stringify(result, null, 2))
    app.exit(result.ok ? 0 : 1)
  })
  await window.loadFile(join(folder, 'index.html'))
}

async function main() {
  const { build } = require('esbuild')
  const { spawn } = require('node:child_process')
  const folder = await mkdtemp(join(tmpdir(), 'kun-poster-smoke-'))
  try {
    await mkdir(join(folder, 'profile'))
    const renderer = join(root, 'src/renderer/src/components/wardrobe/share-poster/share-poster-render.ts')
    // Bundle both the regression and its fix; the control proves this test really
    // exercises a tainted canvas, rather than silently using bundled same-origin art.
    for (const broken of [true, false]) {
      await build({ entryPoints: [renderer], outfile: join(folder, broken ? 'broken.js' : 'fixed.js'), bundle: true, format: 'esm', platform: 'browser',
        alias: { '@shared': join(root, 'src/shared') }, plugins: broken ? [{ name: 'regression-control', setup(builder) {
          builder.onLoad({ filter: /share-poster-render\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path, 'utf8')).replace("if (url.startsWith('kun-asset:')) image.crossOrigin = 'anonymous'", '') }))
        } }] : [] })
    }
    await build({ stdin: { contents: "export { ART_SCHEME } from './src/main/art-assets/protocol-scheme'; export { registerArtProtocol, bindArtResourceReader } from './src/main/art-assets/protocol'", resolveDir: root },
      outfile: join(folder, 'protocol.cjs'), bundle: true, format: 'cjs', platform: 'node', external: ['electron'] })
    await writeFile(join(folder, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('posterSmoke',{report:result=>ipcRenderer.send('poster-smoke-result',result)});")
    const html = await readFile(join(root, 'src/renderer/index.html'), 'utf8')
    const csp = html.match(/content="(default-src[^"]+)"/)[1]
    await writeFile(join(folder, 'index.html'), `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script type="module" src="./test.js"></script>`)
    await writeFile(join(folder, 'test.js'), `
import {renderSharePoster as broken} from './broken.js';
import {renderSharePoster as fixed} from './fixed.js';
const input={look:{color:'sky',face:'happy',outfit:'wizard-cape',prop:'book',bg:'scene:star-deck'},style:'night',size:'portrait',code:'K7QM4XPA',link:'https://kun-agent.com/invite/K7QM4XPA',showCode:true,language:'zh'};
const resources={layerUrl:key=>'kun-asset://poster-smoke/512/'+key+'.webp',artUrl:()=>undefined};
try {
  let previousError;
  try { await broken(input,resources); } catch(error) { previousError=error.name; }
  if(previousError!=='SecurityError') throw new Error('Expected original loader to taint the canvas: '+previousError);
  const results=[];
  for(const style of ['night','sunset','paper']) for(const size of ['portrait','square']) {
    const blob=await fixed({...input,style,size},resources);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(blob.type!=='image/png'||bytes[0]!==137||bytes[1]!==80) throw new Error('Invalid PNG');
    const bitmap=await createImageBitmap(blob);
    const height=size==='portrait'?1440:1080;
    if(bitmap.width!==1080||bitmap.height!==height) throw new Error('Wrong dimensions');
    results.push({style,size,bytes:blob.size,width:bitmap.width,height:bitmap.height});
    bitmap.close();
  }
  window.posterSmoke.report({ok:true,previousError,results});
} catch(error) { window.posterSmoke.report({ok:false,error:String(error)}); }
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(require('electron'), [__filename, '--electron', folder], { cwd: root, env, stdio: 'inherit' })
      child.once('error', reject); child.once('exit', resolveExit)
    })
    if (code !== 0) throw new Error(`Poster smoke exited ${code}`)
  } finally { await rm(folder, { recursive: true, force: true }) }
}
(process.argv.includes('--electron') ? runElectron(process.argv.at(-1)) : main()).catch(error => { console.error(error); process.exit(1) })
