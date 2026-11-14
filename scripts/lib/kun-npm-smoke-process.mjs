import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, delimiter, join, resolve } from 'node:path'

export const delay = (ms) => new Promise((done) => setTimeout(done, ms))

export async function removeSmokeFixture(root) {
  const writable = async (path) => {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return
    // Installed .kunx packages are deliberately immutable. Restore access only
    // inside this disposable fixture, without following links outside it.
    await chmod(path, info.mode | (info.isDirectory() ? 0o700 : 0o600))
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await writable(join(path, name))
    }
  }
  await writable(root)
  await rm(root, { recursive: true, force: true })
}

export function smokeEnvironment(node, root, inherited = process.env) {
  const systemKeys = /^(?:PATH|PATHEXT|HOME|USER|LOGNAME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PROGRAMFILES(?:\(X86\))?|TEMP|TMP|TMPDIR|LANG|LC_.*|TERM|COLORTERM|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|CI)$/i
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => systemKeys.test(key)))
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH')
  const originalPath = pathKey ? env[pathKey] : ''
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key]
  env.PATH = [join(root, 'compiler-guards'), dirname(node), originalPath].filter(Boolean).join(delimiter)
  Object.assign(env, {
    KUN_HOME: join(root, 'kun-home'), KUN_DATA_DIR: join(root, 'data'),
    KUN_MANAGER_CONTROL_DIR: join(root, 'control'), KUN_MANAGER_SETTINGS_PATH: join(root, 'settings.json'),
    KUN_GUI_SETTINGS_PATH: join(root, 'absent-gui-settings.json'), KUN_MCP_CONFIG_PATH: join(root, 'mcp.json'),
    KUN_HOST_NODE_EXECUTABLE: node, KUN_RUNTIME_TOKEN: 'npm-smoke-runtime-token',
    DEEPSEEK_API_KEY: 'npm-smoke-fixture-key', TERM: 'xterm-256color', NO_COLOR: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_engine_strict: 'true', npm_config_userconfig: join(root, 'empty-user.npmrc'),
    npm_config_globalconfig: join(root, 'empty-global.npmrc')
  })
  return env
}

export function locateNpm(node, override) {
  const candidates = [override,
    resolve(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(node), 'node_modules/npm/bin/npm-cli.js'), process.env.npm_execpath]
  const found = candidates.find((file) => file && existsSync(file))
  if (!found) throw new Error('Cannot locate npm-cli.js; pass --npm-cli with the selected Node distribution.')
  return found
}

export async function guardCompilers(root) {
  const directory = join(root, 'compiler-guards')
  await mkdir(directory, { recursive: true })
  for (const name of ['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'make', 'gmake', 'cmake', 'cargo', 'rustc', 'msbuild', 'cl', 'nmake', 'ninja', 'zig']) {
    const file = join(directory, process.platform === 'win32' ? `${name}.cmd` : name)
    const source = process.platform === 'win32'
      ? `@echo off\r\necho compiler ${name}>>"%KUN_NPM_COMPILER_AUDIT%"\r\nexit /b 97\r\n`
      : `#!/bin/sh\nprintf '%s\\n' 'compiler ${name}' >> "$KUN_NPM_COMPILER_AUDIT"\nexit 97\n`
    await writeFile(file, source, { mode: 0o755 })
  }
  return join(root, 'compiler-attempts.log')
}

export function startProcess(command, args, options = {}) {
  const { input, timeout = 60_000, ...spawnOptions } = options
  const grouped = process.platform !== 'win32'
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: grouped, ...spawnOptions })
  const state = { child, stdout: '', stderr: '', code: null, signal: null }
  const limit = 8 * 1024 * 1024
  let timedOut = false
  let killTimer
  const signal = (name) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, name)
      else child.kill(name)
    } catch (error) { if (error.code !== 'ESRCH') state.stderr += `\nstop: ${error.message}` }
  }
  const timer = setTimeout(() => {
    timedOut = true
    signal('SIGTERM')
    killTimer = setTimeout(() => signal('SIGKILL'), 5_000)
  }, timeout)
  child.stdout.on('data', (part) => { state.stdout = (state.stdout + part).slice(-limit) })
  child.stderr.on('data', (part) => { state.stderr = (state.stderr + part).slice(-limit) })
  state.done = new Promise((done, reject) => {
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer)
      Object.assign(state, { code, signal, timedOut })
      done(state)
    })
  })
  child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') state.stderr += `\nstdin: ${error.message}` })
  if (input !== undefined) child.stdin.end(input)
  else child.stdin.end()
  return state
}

export async function runProcess(command, args, options = {}) {
  const state = await startProcess(command, args, options).done
  if (state.code !== 0 && !options.allowFailure) {
    throw new Error(`${command} failed (${state.code ?? state.signal}${state.timedOut ? ', timeout' : ''}):\n${state.stderr}\n${state.stdout}`)
  }
  return state
}

export async function waitUntil(read, label, timeout = 30_000) {
  const until = Date.now() + timeout
  let lastError
  while (Date.now() < until) {
    try {
      const result = await read()
      if (result) return result
    } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
