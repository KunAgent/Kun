'use strict'

const { execFileSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

function smokeWindowsStartupHelpers(resources) {
  if (process.platform !== 'win32') return
  const directory = mkdtempSync(join(tmpdir(), 'kun-packaged-startup-'))
  const entry = join(directory, 'smoke.cjs')
  const runtime = join(resources, 'app.asar.unpacked/kun/dist')
  const electron = join(resources, '..', 'Kun.exe')
  const moduleUrl = (file) => JSON.stringify(pathToFileURL(join(runtime, file)).href)
  // A fresh TEMP has no launcher cache. Any attempt to invoke PowerShell for
  // identity or runtime compilation fails in Node and Electron's Node mode.
  // The existing installer/update GUI smoke exercises actual packaged Main;
  // a packaged exe does not honor a replacement main script on its command line.
  writeFileSync(entry, `
const cp = require('node:child_process');
for (const method of ['execFileSync', 'execFile', 'spawn']) {
  const original = cp[method];
  cp[method] = function(command, ...args) {
    if (/powershell|pwsh/i.test(String(command))) throw new Error('PowerShell is disabled in startup smoke');
    return original.call(this, command, ...args);
  };
}
require('node:module').syncBuiltinESMExports();
(async()=>{
  const native = await import(${moduleUrl('process/windows-startup-native.js')});
  const owned = await import(${moduleUrl('process/owned-process-windows.js')});
  const lock = await import(${moduleUrl('manager/manager-start-lock.js')});
  const binding = native.windowsStartupNative();
  if (!binding.inspectProcess(process.pid).identity?.startsWith('win32-v1:')) throw new Error('Missing birth identity');
  await lock.withManagerStartLock(${JSON.stringify(join(directory, 'profile'))}, async()=>{});
  const candidate = await binding.acquireStartLock(${JSON.stringify(join(directory, 'candidate.lock'))});
  if (!candidate) throw new Error('Packaged native startup lock was not acquired');
  try { await binding.writeStartLock(candidate.handle, JSON.stringify({pid:process.pid})); }
  finally { await binding.releaseStartLock(candidate.handle, true); }
  const child = await owned.spawnWindowsOwnedProcess(${JSON.stringify(electron)}, ['-e',
    'process.send({pid:process.pid});process.on("message",()=>process.exit(0));setInterval(()=>{},1000)'], {
      stdio:['ignore','pipe','pipe','ipc'], env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}
    });
  try {
    const message = await new Promise(r=>child.once('message',r));
    if(message.pid !== child.pid) throw new Error('IPC does not identify the Job child');
    child.send('stop');
    await owned.stopWindowsOwnedProcess(child,{graceMs:1000,timeoutMs:5000});
  } finally { await owned.shutdownWindowsOwnedProcesses({timeoutMs:5000}); }
  console.log('KUN_WINDOWS_STARTUP_HELPERS_OK');
})().catch(error=>{console.error(error);process.exit(1)});
`)
  try {
    for (const executable of [process.execPath, electron]) {
      const env = { ...process.env, TEMP: directory, TMP: directory }
      if (executable === electron) env.ELECTRON_RUN_AS_NODE = '1'
      else delete env.ELECTRON_RUN_AS_NODE
      const output = execFileSync(executable, [entry], { env, encoding: 'utf8', timeout: 60_000, windowsHide: true })
      if (!output.includes('KUN_WINDOWS_STARTUP_HELPERS_OK')) throw new Error('Packaged Windows helper smoke did not complete')
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
if (require.main === module) {
  const index = process.argv.indexOf('--resources')
  if (index < 0 || !process.argv[index + 1]) throw new Error('--resources is required')
  smokeWindowsStartupHelpers(resolve(process.argv[index + 1]))
}
module.exports = { smokeWindowsStartupHelpers }
