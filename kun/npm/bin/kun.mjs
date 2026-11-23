#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function npmStartupError(version, platform, arch, glibc = true) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match || Number(match[1]) !== 26 || Number(match[2]) < 4) {
    return `Node.js >=26.4.0 <27 is required for the npm distribution; detected ${version}. Upgrade Node.js and check PATH.`
  }
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'].includes(`${platform}-${arch}`) ||
    (platform === 'linux' && !glibc)) {
    return `The npm distribution does not support ${platform}-${arch}${platform === 'linux' && !glibc ? ' (musl)' : ''}. Supported: macOS arm64/x64, Windows x64, Linux glibc arm64/x64.`
  }
}

export function isTuiInvocation(args) {
  const first = args[0]
  return !first || first === 'tui' || (first.startsWith('-') && !['--help', '-h', '--version', '-V'].includes(first))
}

export async function runNpmCli(args = process.argv.slice(2)) {
  const glibc = process.platform !== 'linux' || Boolean(process.report?.getReport()?.header?.glibcVersionRuntime)
  const error = npmStartupError(process.versions.node, process.platform, process.arch, glibc)
  if (error) {
    process.stderr.write(`kun: ${error}\n`)
    return 69
  }
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  if (manifest.kunNpm?.kind !== 'npm') throw new Error('Invalid Kun npm distribution metadata; reinstall the package.')
  if (manifest.kunNpm.targets && !manifest.kunNpm.targets.includes(`${process.platform}-${process.arch}`)) {
    process.stderr.write(`kun: this candidate does not contain the required ${process.platform}-${process.arch} payload. Rebuild with its platform components.\n`)
    return 69
  }
  if (['--version', '-V', 'version'].includes(args[0])) {
    process.stdout.write(`kun ${manifest.version} (npm ${manifest.name})\n`)
    return 0
  }
  if (['--help', '-h', 'help'].includes(args[0])) {
    const { KUN_CLI_USAGE } = await import('../dist/cli/kun-cli-command.js')
    process.stdout.write(`${KUN_CLI_USAGE}\nNpm distribution: ${manifest.name}@${manifest.version}\n` +
      'Desktop canvas, Computer Use and bundled desktop Skills/extensions are not included.\n')
    return 0
  }
  if (args[0] === 'update') {
    const unknown = args.slice(1).find(value => !['--check', '--yes', '--help', '-h'].includes(value))
    if (unknown) { process.stderr.write(`kun update: unknown option ${unknown}\n`); return 64 }
    if (args.includes('--check') && args.includes('--yes')) {
      process.stderr.write('kun update: --check and --yes are mutually exclusive\n')
      return 64
    }
    process.stdout.write(`This is the npm distribution (${manifest.name}@${manifest.version}).\n` +
      `Global installation: npm install -g ${manifest.name}@<version>\n` +
      `Project installation: npm install ${manifest.name}@<version>\n` +
      'Exit the owned Kun session before updating. User data is kept separately from this package.\n')
    return 0
  }
  if (isTuiInvocation(args) && !args.includes('--help') && !args.includes('-h') &&
    !process.execArgv.includes('--experimental-ffi')) {
    const entry = fileURLToPath(import.meta.url)
    const flags = ['--experimental-ffi', '--disable-warning=ExperimentalWarning', entry, ...args]
    if (process.platform !== 'win32' && typeof process.execve === 'function') {
      process.execve(process.execPath, [process.execPath, ...flags], process.env)
      throw new Error('Could not replace the npm TUI launcher')
    }
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, flags, { stdio: 'inherit', env: process.env })
      // Windows delivers console Ctrl+C to both processes; do not forward it twice.
      const interrupt = () => {}
      const terminate = () => child.kill('SIGTERM')
      process.on('SIGINT', interrupt)
      process.on('SIGTERM', terminate)
      const cleanup = () => {
        process.removeListener('SIGINT', interrupt)
        process.removeListener('SIGTERM', terminate)
      }
      child.once('error', error => { cleanup(); reject(error) })
      child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal ? 1 : 0)) })
    })
  }
  await import('../dist/cli/serve-entry.js')
  return process.exitCode ?? 0
}

let invoked = false
try { invoked = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) } catch { /* Importing helpers does not invoke the command. */ }
if (invoked) {
  try { process.exitCode = await runNpmCli() } catch (error) {
    process.stderr.write(`kun: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 70
  }
}
