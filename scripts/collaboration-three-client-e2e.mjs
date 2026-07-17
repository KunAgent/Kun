import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const cargo = resolveCargo()
const env = { ...process.env }
if (process.platform === 'win32' && cargo.includes('.rustup')) {
  const rustc = resolve(cargo, '..', 'rustc.exe')
  if (existsSync(rustc)) env.RUSTC = rustc
}
run(cargo, [
  'test', '--manifest-path', resolve(root, 'native/kun-collab-crypto/Cargo.toml'),
  '--test', 'mls_vectors', 'three_clients_catch_up_and_removed_member_cannot_read_later_epoch', '--', '--exact'
])
run(cargo, ['test', '--manifest-path', resolve(root, 'native/kun-collab-server/Cargo.toml'), '--test', 'server_integration'])
console.log('Three-client Collaboration protocol acceptance passed.')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveCargo() {
  if (process.env.CARGO) return process.env.CARGO
  const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  const triple = process.platform === 'win32' ? 'stable-x86_64-pc-windows-msvc' : 'stable-x86_64-unknown-linux-gnu'
  const direct = resolve(homedir(), '.rustup', 'toolchains', triple, 'bin', executable)
  return existsSync(direct) ? direct : executable
}
