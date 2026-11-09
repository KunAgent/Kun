'use strict'

// Reproducible, equal-length repair of the already verified migration image.
// This avoids ingesting concurrently changing workbench/runtime dependencies.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const acorn = require('acorn')
const asar = require('@electron/asar')
const { Pickle } = require(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js'))
const { verifyMacAppSigning } = require('./mac-signing-policy.cjs')
const { writeRuntimeIntegrityManifest } = require('./after-pack-runtime-integrity.cjs')
const [sourceApp, destinationApp, auditFile] = process.argv.slice(2).map(value => path.resolve(value))
assert.ok(sourceApp && destinationApp && auditFile)
assert.ok(!fs.existsSync(destinationApp), 'Never overwrite an existing migration image')
verifyMacAppSigning(sourceApp, { bundleId: 'com.xingyuzhong.deepseekgui', env: { MAC_SIGN: '1' } })
fs.mkdirSync(path.dirname(destinationApp), { recursive: true })
execFileSync('ditto', [sourceApp, destinationApp])
const resources = path.join(destinationApp, 'Contents/Resources')
const archive = path.join(resources, 'app.asar'), raw = asar.getRawHeader(archive)
const beforeHeader = crypto.createHash('sha256').update(raw.headerString).digest('hex')
const changed = []
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function entry(name) {
  let item = raw.header
  for (const segment of name.split('/')) { assert.ok(Object.hasOwn(item.files, segment)); item = item.files[segment] }
  return item
}
function updateEntry(name, bytes) {
  const info = entry(name)
  assert.equal(bytes.length, info.size, `Only equal-length replacements are supported: ${name}`)
  if (info.integrity) {
    const blocks = []
    for (let i = 0; i < bytes.length; i += info.integrity.blockSize) blocks.push(hash(bytes.subarray(i, i + info.integrity.blockSize)))
    info.integrity = { ...info.integrity, hash: hash(bytes), blocks }
  }
  if (info.unpacked) fs.writeFileSync(path.join(archive + '.unpacked', name), bytes)
  else {
    const fd = fs.openSync(archive, 'r+')
    try { fs.writeSync(fd, bytes, 0, bytes.length, 8 + raw.headerSize + Number(info.offset)); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
  }
}
function patch(name, transform) {
  const before = asar.extractFile(archive, name), after = Buffer.from(transform(before.toString()), 'utf8')
  assert.notEqual(hash(before), hash(after))
  updateEntry(name, after)
  changed.push({ file: name, beforeSha256: hash(before), afterSha256: hash(after), bytes: after.length })
}
const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json'))
assert.equal(packageInfo.version, '0.4.5-control.1')
const infoCode = asar.extractFile(archive, 'node_modules/@kun/control-runtime/dist/info.js').toString()
const baselines = JSON.parse(/^export const BASELINES = (.*);$/m.exec(infoCode)[1])
assert.match(baselines['darwin-arm64'].releaseId, /^control-0\.1\.2-/)
const modifications = []
function visit(node, file, source) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'CallExpression' && node.arguments[1]?.type === 'ArrayExpression' &&
      node.arguments[1].elements[0]?.value === '--identity' && node.arguments[2]?.type === 'ObjectExpression') {
    const timeout = node.arguments[2].properties.find(prop => (prop.key.name || prop.key.value) === 'timeout')
    assert.equal(timeout?.value.value, 1500)
    modifications.push({ file, start: timeout.value.start, end: timeout.value.end, source })
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) visit(child, file, source)
    else if (value && typeof value === 'object') visit(value, file, source)
  }
}
for (const file of asar.listPackage(archive).filter(name => name.startsWith('/out/main/') && name.endsWith('.js'))) {
  const source = asar.extractFile(archive, file.slice(1)).toString()
  if (!source.includes('"--identity"')) continue
  visit(acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), file.slice(1), source)
}
assert.equal(modifications.length, 1, 'Exactly one identity probe may change')
const edit = modifications[0]
patch(edit.file, value => value.slice(0, edit.start) + '5000' + value.slice(edit.end))
for (const file of ['package.json', 'kun/dist/runtime-build.json']) {
  patch(file, value => {
    assert.equal((value.match(/0\.4\.5-control\.1/g) || []).length, 1)
    return value.replace('0.4.5-control.1', '0.4.5-control.3')
  })
}
const newHeader = JSON.stringify(raw.header)
assert.equal(Buffer.byteLength(newHeader), Buffer.byteLength(raw.headerString), 'ASAR body offsets must remain unchanged')
const header = Pickle.createEmpty(); header.writeString(newHeader)
assert.equal(header.toBuffer().length, raw.headerSize)
const fd = fs.openSync(archive, 'r+')
try { fs.writeSync(fd, header.toBuffer(), 0, raw.headerSize, 8); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
asar.uncacheAll()
for (const item of changed) assert.equal(hash(asar.extractFile(archive, item.file)), item.afterSha256)
const plist = path.join(destinationApp, 'Contents/Info.plist')
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString 0.4.5-control.3', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion 0.4.5-control.3', plist])
const headerHash = hash(Buffer.from(newHeader))
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :ElectronAsarIntegrity:Resources/app.asar:hash ' + headerHash, plist])
writeRuntimeIntegrityManifest({ electronPlatformName: 'darwin', arch: 'arm64' }, resources)
fs.mkdirSync(path.dirname(auditFile), { recursive: true })
fs.writeFileSync(auditFile, JSON.stringify({ sourceApp, destinationApp, beforeHeader, afterHeader: headerHash, changed,
  version: '0.4.5-control.3', baseline: baselines['darwin-arm64'].releaseId, sourceFix: 'src/main/remote-desktop/native-input.ts: identity startup deadline 5000 ms' }, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ repaired: true, changedFiles: changed.length, version: '0.4.5-control.3', baseline: baselines['darwin-arm64'].releaseId }))
