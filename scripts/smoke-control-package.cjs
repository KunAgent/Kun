const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const temporary = mkdtempSync(join(tmpdir(), 'kun-control-electron-'))
async function main() {
  try {
    const runtime = dirname(require.resolve('@kun/control-runtime/package.json'))
    const directory = join(runtime, 'baselines', `${process.platform}-${process.arch}`)
    const release = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    const fixture = `
      import {app} from 'electron';
      import {startControlProcess} from ${JSON.stringify(resolve('src/main/control-host/process.ts'))};
      app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))});
      app.on('window-all-closed', () => {});
      const timeout = setTimeout(() => app.exit(1), 20000);
      app.whenReady().then(async () => {
        let child;
        try {
          child = await startControlProcess(${JSON.stringify(directory)}, ${JSON.stringify(release)}, {}, () => {}, () => {});
          const health = await child.rpc.call('health');
          if (health.releaseId !== ${JSON.stringify(release.releaseId)}) throw Error('release_mismatch');
          await child.stop();
          if (!child.exited) throw Error('exit_unconfirmed');
          console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,health,exitConfirmed:true}));
          clearTimeout(timeout); app.exit(0);
        } catch(error) { console.error(error.message); await child?.stop().catch(()=>{}); clearTimeout(timeout); app.exit(1); }
      });`
    await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
      platform: 'node', format: 'cjs', external: ['electron'], outfile: join(temporary, 'main.cjs') })
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ name: 'kun-control-smoke', version: '1.0.0', main: 'main.cjs' }))
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [temporary], { env, timeout: 30000, encoding: 'utf8' })
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, result.error?.message || 'Control utility process smoke failed')
    assert.match(result.stdout || '', /"exitConfirmed":true/)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
