import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Build-time only. Installed applications never invoke compilers or PowerShell.
if (process.platform === 'win32') {
  const require = createRequire(import.meta.url)
  const root = fileURLToPath(new URL('../', import.meta.url))
  const arch = process.env.KUN_WINDOWS_BUILD_ARCH ?? process.arch
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Windows helper architecture: ${arch}`)
  const output = join(root, 'dist', 'native', `win32-${arch}`)
  const work = await mkdtemp(join(tmpdir(), 'kun-startup-build-'))
  try {
    await mkdir(output, { recursive: true })
    for (const name of ['binding.gyp', 'startup.cc']) {
      await copyFile(join(root, 'native', 'windows-startup', name), join(work, name))
    }
    execFileSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild',
      '--directory', work, '--arch', arch], { stdio: 'inherit' })
    await copyFile(join(work, 'build', 'Release', 'kun_windows_startup.node'), join(output, 'kun_windows_startup.node'))
    const ts = require('typescript')
    const launcherModule = join(work, 'launcher-source.mjs')
    const sourceModule = await readFile(join(root, 'src', 'process', 'owned-process-windows-launcher.ts'), 'utf8')
    await writeFile(launcherModule, ts.transpileModule(sourceModule, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText)
    const { WINDOWS_OWNED_LAUNCHER_SOURCE } = await import(pathToFileURL(launcherModule).href)
    const source = join(work, 'launcher.cs')
    const compiled = join(work, 'kun-owned-launcher.exe')
    await writeFile(source, WINDOWS_OWNED_LAUNCHER_SOURCE)
    const script = '$ErrorActionPreference="Stop"; Add-Type -Path $env:KUN_LAUNCHER_SOURCE -OutputAssembly $env:KUN_LAUNCHER_OUTPUT -OutputType ConsoleApplication'
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      stdio: 'inherit', timeout: 60_000,
      env: { ...process.env, KUN_LAUNCHER_SOURCE: source, KUN_LAUNCHER_OUTPUT: compiled }
    })
    await copyFile(compiled, join(output, 'kun-owned-launcher.exe'))
    const files = {}
    for (const name of ['kun_windows_startup.node', 'kun-owned-launcher.exe']) {
      files[name] = createHash('sha256').update(await readFile(join(output, name))).digest('hex')
    }
    await writeFile(join(output, 'manifest.json'), JSON.stringify({ version: 1, arch, files }, null, 2) + '\n')
    console.log(`[windows-startup] Built integrity-checked helpers for ${arch}`)
  } finally { await rm(work, { recursive: true, force: true }) }
}
