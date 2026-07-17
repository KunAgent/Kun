import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargo = resolveCargo()
const env = { ...process.env }
if (process.platform === 'win32' && cargo.includes('.rustup')) {
  const rustc = resolve(dirname(cargo), 'rustc.exe')
  if (existsSync(rustc)) env.RUSTC = rustc
}
runCargo(['build', '--release', '--manifest-path', resolve(root, 'native/kun-collab-crypto/Cargo.toml')])
runCargo(['build', '--release', '--manifest-path', resolve(root, 'native/kun-collab-server/Cargo.toml')])

const extension = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so'
const prefix = process.platform === 'win32' ? '' : 'lib'
const source = resolve(root, `native/kun-collab-crypto/target/release/${prefix}kun_collab_crypto.${extension}`)
const destination = resolve(
  root,
  `native/kun-collab-crypto/prebuilds/${process.platform}-${process.arch}/kun-collab-crypto.node`
)
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)

const binding = createRequire(import.meta.url)(destination)
const version = binding.openmlsBindingVersion?.()
if (typeof version !== 'string' || !version.includes('rfc9420')) {
  throw new Error('Built Collaboration native module failed its RFC 9420 load check')
}
console.log(`Built ${destination} (${version})`)

const serverSource = resolve(
  root,
  `native/kun-collab-server/target/release/kun-collab-server${process.platform === 'win32' ? '.exe' : ''}`
)
const serverDestination = resolve(
  root,
  `native/kun-collab-server/prebuilds/${process.platform}-${process.arch}/kun-collab-server${process.platform === 'win32' ? '.exe' : ''}`
)
await mkdir(dirname(serverDestination), { recursive: true })
await copyFile(serverSource, serverDestination)
const serverCheck = spawnSync(serverDestination, ['--help'], { cwd: root, encoding: 'utf8' })
if (serverCheck.status !== 0 || !serverCheck.stdout.includes('kun-collab-server')) {
  throw new Error('Built Collaboration server failed its executable load check')
}
console.log(`Built ${serverDestination}`)

function runCargo(args) {
  const result = spawnSync(cargo, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveCargo() {
  if (process.env.CARGO) return process.env.CARGO
  const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  const directStable = resolve(
    homedir(),
    '.rustup',
    'toolchains',
    process.platform === 'win32' ? 'stable-x86_64-pc-windows-msvc' : 'stable-x86_64-unknown-linux-gnu',
    'bin',
    executable
  )
  return existsSync(directStable) ? directStable : executable
}
