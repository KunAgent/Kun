import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcess } from './kun-npm-smoke-process.mjs'

export async function exerciseInstalledWindows(context) {
  const { node, installed, root, env, config, check } = context
  const platformRoot = join(installed.root, 'node_modules', installed.manifest.kunNpm.windowsPackage)
  await check('NPM-04.windows-native-job', async () => {
    const fixture = fileURLToPath(new URL('../fixtures/kun-npm/windows-helper-probe.mjs', import.meta.url))
    const result = await runProcess(node, [fixture, installed.root, root], { cwd: root, env, timeout: 90_000 })
    const line = result.stdout.trim().split('\n').findLast(line => line.startsWith('{'))
    const detail = JSON.parse(line)
    assert(detail.nativeLock && detail.descendantListenerClosed && detail.ownerLossCleanup)
    return detail
  })
  for (const mode of ['missing', 'corrupt']) await check(`NPM-04.windows-helper-${mode}`, async () => {
    const manifestPath = join(platformRoot, 'manifest.json')
    const original = await readFile(manifestPath)
    const nativePath = join(platformRoot, 'kun_windows_startup.node')
    try {
      if (mode === 'missing') await rename(nativePath, nativePath + '.held')
      else {
        const value = JSON.parse(original)
        value.files['kun_windows_startup.node'] = '0'.repeat(64)
        await writeFile(manifestPath, JSON.stringify(value))
      }
      const result = await runProcess(node, [installed.entry, 'serve', '--config', config, '--port', '0'],
        { cwd: root, env, timeout: 30_000, allowFailure: true })
      assert(!result.timedOut, 'Damaged startup components must fail before the watchdog')
      assert.notEqual(result.code, 0)
      assert.match(result.stderr + result.stdout, /startup components|windows_startup_integrity|repair or reinstall/i)
      assert(!existsSync(join(env.KUN_DATA_DIR, 'runtime.json')), 'Damaged payload left a Runtime registration')
      assert(!existsSync(join(env.KUN_MANAGER_CONTROL_DIR, 'manager.json')), 'Damaged payload left a Manager')
      return { exitCode: result.code, runtimeStarted: false, managerStarted: false }
    } finally {
      await writeFile(manifestPath, original)
      if (mode === 'missing') await rename(nativePath + '.held', nativePath)
    }
  })
}
