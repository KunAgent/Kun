import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [packageRoot, root] = process.argv.slice(2)
const load = name => import(pathToFileURL(join(packageRoot, 'dist/process', name)).href)
const { windowsStartupNative } = await load('windows-startup-native.js')
const owned = await load('owned-process-windows.js')
const native = windowsStartupNative()
assert(native.inspectProcess(process.pid).identity?.startsWith('win32-v1:'))
const lock = await native.acquireStartLock(join(root, 'native fixture 中文.lock'))
assert(lock)
try { await native.writeStartLock(lock.handle, JSON.stringify({ pid: process.pid })) }
finally { await native.releaseStartLock(lock.handle, true) }

const childSource = `
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e',${JSON.stringify(`
    const server=require('node:http').createServer((q,r)=>r.end('job-fixture'));
    server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:server.address().port})));
  `)}],{stdio:['ignore','pipe','inherit']});
  let text='';child.stdout.on('data',bytes=>{text+=bytes;if(text.includes('\\n'))process.send({pid:process.pid,child:JSON.parse(text.split('\\n')[0])})});
  setInterval(()=>{},1000);
`
const untilDead = async pid => {
  const deadline = Date.now() + 15_000
  while (native.inspectProcess(pid).state !== 'dead') {
    assert(Date.now() < deadline, `Windows Job participant ${pid} survived cleanup`)
    await new Promise(done => setTimeout(done, 50))
  }
}
let child
let owner
try {
  child = await owned.spawnWindowsOwnedProcess(process.execPath, ['-e', childSource], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: process.env
  })
  const ready = await new Promise(done => child.once('message', done))
  assert.equal(ready.pid, child.pid, 'Job handshake must identify the actual target PID')
  const identities = [ready.pid, ready.child.pid].map(pid => ({ pid, identity: native.inspectProcess(pid).identity }))
  assert(identities.every(value => value.identity))
  assert((await fetch(`http://127.0.0.1:${ready.child.port}`)).ok)
  await owned.stopWindowsOwnedProcess(child, { graceMs: 200, timeoutMs: 8_000 })
  for (const value of identities) await untilDead(value.pid)
  await assert.rejects(fetch(`http://127.0.0.1:${ready.child.port}`, { signal: AbortSignal.timeout(1_000) }))
  const module = pathToFileURL(join(packageRoot, 'dist/process/owned-process-windows.js')).href
  const ownerSource = `
    (async()=>{const own=await import(${JSON.stringify(module)});
    const child=await own.spawnWindowsOwnedProcess(process.execPath,['-e',${JSON.stringify(childSource)}],{
      stdio:['ignore','pipe','pipe','ipc'],env:process.env,ownerLossGraceMs:2500});
    child.once('message',value=>console.log(JSON.stringify(value)));setInterval(()=>{},1000)})().catch(error=>{console.error(error);process.exit(1)});
  `
  owner = spawn(process.execPath, ['--eval', ownerSource], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env })
  let text = ''
  const orphan = await new Promise(done => owner.stdout.on('data', bytes => {
    text += bytes
    if (text.includes('\n')) done(JSON.parse(text.split('\n')[0]))
  }))
  owner.kill('SIGKILL')
  await untilDead(orphan.pid)
  await untilDead(orphan.child.pid)
  await assert.rejects(fetch(`http://127.0.0.1:${orphan.child.port}`, { signal: AbortSignal.timeout(1_000) }))
  // Resolve through the installed package, never the build checkout.
  const manifest = createRequire(join(packageRoot, 'package.json'))('./package.json')
  console.log(JSON.stringify({ nativeLock: true, actualJobTargetPid: ready.pid, identities,
    descendantListenerClosed: true, ownerLossCleanup: true, ownerLossTestGraceMs: 2500,
    platformPackage: manifest.kunNpm.windowsPackage, version: manifest.version }))
} finally {
  owner?.kill('SIGKILL')
  if (child) await owned.stopWindowsOwnedProcess(child, { graceMs: 0, timeoutMs: 5_000 })
  await owned.shutdownWindowsOwnedProcesses()
}
