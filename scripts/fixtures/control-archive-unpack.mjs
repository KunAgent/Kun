// Exercises the installed vendored implementation in a fresh native ESM process.
// File-handle rules emulate Windows; no native Job/ConPTY or network is involved.
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { create } from 'tar'

const mode = process.argv[2]
const root = await fs.mkdtemp(join(tmpdir(), 'kun-control-unpack-'))
const source = join(root, 'source'), output = join(root, 'output'), archive = join(root, 'runtime.tgz')
const events = []
const originalOpen = fs.open, originalChmod = fs.chmod
let result
try {
  await fs.mkdir(source)
  const bytes = Buffer.from('module.exports = { ready: true }\n')
  const release = { files: { 'runtime.cjs': { size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } } }
  const raw = Buffer.from(JSON.stringify(release))
  await fs.writeFile(join(source, 'manifest.json'), raw)
  await fs.writeFile(join(source, 'runtime.cjs'), mode === 'corrupt' ? Buffer.alloc(bytes.length) : bytes)
  if (mode === 'readonly-input') {
    await fs.chmod(join(source, 'manifest.json'), 0o400)
    await fs.chmod(join(source, 'runtime.cjs'), 0o400)
  }
  await create({ gzip: true, file: archive, cwd: source }, ['manifest.json', 'runtime.cjs'])
  const tracked = path => typeof path === 'string' && path.startsWith(`${output}${sep}`)
  fs.chmod = async (path, permissions) => {
    if (tracked(path)) events.push({ file: relative(output, path), operation: 'chmod', mode: permissions })
    return originalChmod(path, permissions)
  }
  fs.open = async (path, flags, ...args) => {
    if (!tracked(path)) return originalOpen(path, flags, ...args)
    const file = relative(output, path)
    events.push({ file, operation: 'open', flags })
    const writable = Boolean((await fs.stat(path)).mode & 0o200)
    if (flags === 'r+' && !writable) throw Object.assign(new Error('Read-only Windows file'), { code: 'EACCES' })
    const handle = await originalOpen(path, flags, ...args)
    const sync = handle.sync.bind(handle), close = handle.close.bind(handle)
    handle.sync = async () => {
      events.push({ file, operation: 'sync' })
      if (flags === 'r') throw Object.assign(new Error('FlushFileBuffers requires write access'), { code: 'EPERM' })
      if (mode === 'sync-failure') throw Object.assign(new Error('Disk sync failed'), { code: 'EIO' })
      return sync()
    }
    handle.close = async () => { events.push({ file, operation: 'close' }); return close() }
    return handle
  }
  syncBuiltinESMExports()
  const entry = import.meta.resolve('@kun/control-host')
  const { unpack } = await import(new URL('./archive.js', entry))
  try {
    await unpack(archive, output, release, raw)
    const files = await fs.readdir(output)
    const states = await Promise.all(files.map(file => fs.stat(join(output, file))))
    result = { ok: true, files: files.length, readOnly: states.every(stat => !(stat.mode & 0o200)) }
  } catch (error) {
    result = { ok: false, code: error.code ?? error.message, files: 0, readOnly: false }
  }
} finally {
  fs.open = originalOpen
  fs.chmod = originalChmod
  syncBuiltinESMExports()
  await fs.rm(root, { recursive: true, force: true })
}
console.log(JSON.stringify({ ...result, events }))
