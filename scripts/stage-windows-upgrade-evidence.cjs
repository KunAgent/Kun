'use strict'

// Copy only this run's explicitly owned evidence onto the checkout volume.
// Never move recovery records, traverse AppData, or upload whole profiles.
const { constants } = require('node:fs')
const { lstat, realpath, open, mkdir, opendir, writeFile } = require('node:fs/promises')
const { resolve, relative, dirname, basename, join, sep, isAbsolute } = require('node:path')
const { createHash } = require('node:crypto')

const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_FILES = 128
const ROOT_FILES = new Set(['scenario.json', 'updater-events.jsonl', 'installer.log', 'installer-result.json',
  'upgrade-source.json', 'windows-processes.json', 'windows-paths.json', 'failure.txt',
  'prepared-restart-before-launch.json', 'prepared-restart-pending-removed.json', 'prepared-restart-observation-end.json',
  'dialogue-diagnostics.json', 'runtime-diagnostics.json', 'gui.stdout.log', 'gui.stderr.log'])
const SECRET_KEY = /(?:token|secret|password|credential|authorization|api[-_]?key|commandline)/i

function sanitizeText(text) {
  // These two expressions deliberately remove terminal control bytes.
  /* eslint-disable no-control-regex */
  const clean = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  /* eslint-enable no-control-regex */
  let uncertainQuotedValue = false
  return clean.split('\n').map(line => {
    if (uncertainQuotedValue) return '[REDACTED: continuation after unterminated sensitive value]'
    const mayContainSecret = /token|password|secret|credential|authorization|commandline|api[-_]?key/i.test(line)
    const assignment = mayContainSecret ? /(?:api[-_]?key|[\w.-]{0,128}token|password|secret|credential[\w.-]*|authorization|commandline)[\\"']*\s*[:=]\s*/i.exec(line) : null
    if (assignment) {
      const value = line.slice(assignment.index + assignment[0].length)
      const quoted = value.match(/^(?:\\)?(["'])/)
      if (quoted) {
        // Once the diagnostic is cut inside a quoted secret, no later line is
        // safe to interpret as a separate record. Fail closed for the remainder.
        const afterOpening = value.slice(quoted[0].length)
        const closing = quoted[1] === '"' ? /(?<!\\)"/ : /(?<!\\)'/
        uncertainQuotedValue = !closing.test(afterOpening)
      }
      return '[REDACTED: sensitive assignment]'
    }
    return line.replace(/((?:Bearer|Basic)\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/([?&](?:token|key|api_key|access_token)=)[^&\s"']+/gi, '$1[REDACTED]')
  }).join('\n')
}
function sanitizeValue(value, depth = 0) {
  if (depth > 20) return '[DEPTH LIMIT]'
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.slice(0, 256).map(item => sanitizeValue(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 256)
    .map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1)]))
  return value
}
function sanitizeDiagnostic(text, extension) {
  const clean = text.replace(/^\uFEFF/u, '')
  if (extension === '.json') {
    try { return JSON.stringify(sanitizeValue(JSON.parse(clean)), null, 2) + '\n' }
    catch { return JSON.stringify({ status: 'REDACTED', diagnostic: 'malformed or truncated JSON diagnostic' }) + '\n' }
  }
  if (extension === '.jsonl') return clean.split('\n').map(line => {
    if (!line.trim()) return ''
    try { return JSON.stringify(sanitizeValue(JSON.parse(line))) }
    catch { return JSON.stringify({ redacted: 'malformed or truncated JSONL record' }) }
  }).join('\n')
  return sanitizeText(clean)
}
function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
async function assertPlainPath(path) {
  const absolute = resolve(path)
  let cursor = absolute
  const parts = []
  while (dirname(cursor) !== cursor) { parts.push(cursor); cursor = dirname(cursor) }
  for (const part of parts.reverse()) {
    const info = await lstat(part)
    if (info.isSymbolicLink()) throw new Error('Symbolic link or junction rejected')
  }
  if (!samePath(await realpath(absolute), absolute)) throw new Error('Reparse/path redirection rejected')
  return lstat(absolute)
}
async function boundedRead(path, maximum = MAX_FILE_BYTES) {
  const before = await assertPlainPath(path)
  if (!before.isFile()) throw new Error('Not a regular diagnostic file')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new Error('Diagnostic identity changed')
    await assertPlainPath(path)
    const bytes = Buffer.alloc(Math.min(info.size, maximum))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return { text: bytes.subarray(0, bytesRead).toString('utf8'), truncated: info.size > maximum }
  } finally { await handle.close() }
}
async function boundedEntries(path) {
  const entries = []
  for await (const entry of await opendir(path)) {
    entries.push(entry)
    if (entries.length >= MAX_FILES) break
  }
  return entries
}
async function stageEvidence({ reportPath, outputDirectory, appData, workspace = process.cwd() }) {
  const workspaceRoot = await realpath(resolve(workspace))
  const output = resolve(outputDirectory)
  const outputRelative = relative(workspaceRoot, output)
  if (!outputRelative || outputRelative.startsWith('..' + sep) || outputRelative === '..' || isAbsolute(outputRelative)) {
    throw new Error('Evidence output must be a child of the checkout')
  }
  // Check each existing ancestor before mkdir; do not follow a preplaced link.
  let parent = dirname(output)
  while (true) {
    try { await assertPlainPath(parent); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; parent = dirname(parent) }
  }
  await mkdir(dirname(output), { recursive: true })
  await assertPlainPath(dirname(output))
  await mkdir(output)
  await assertPlainPath(output)
  const manifest = { schemaVersion: 1, status: 'collected', files: [], warnings: [], roots: [], bytes: 0,
    limits: { payloadFileBytes: MAX_FILE_BYTES, payloadTotalBytes: MAX_TOTAL_BYTES, payloadFiles: MAX_FILES, collectionBytes: MAX_FILE_BYTES } }
  const warning = (source, error) => {
    if (manifest.warnings.length < MAX_FILES) manifest.warnings.push({ source, error: sanitizeText(error.message || String(error)).slice(0, 2048) })
  }
  const copy = async (source, destination) => {
    if (manifest.files.length >= MAX_FILES || manifest.bytes >= MAX_TOTAL_BYTES) {
      warning(destination, new Error('Evidence budget exhausted')); return
    }
    try {
      const { text, truncated } = await boundedRead(source, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - manifest.bytes))
      const extension = destination.endsWith('.jsonl') ? '.jsonl' : destination.endsWith('.json') ? '.json' : '.txt'
      let data = Buffer.from(sanitizeDiagnostic(text, extension))
      const limit = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - manifest.bytes)
      const capped = data.length > limit
      if (capped) data = data.subarray(0, limit)
      const target = join(output, destination)
      await mkdir(dirname(target), { recursive: true })
      await assertPlainPath(dirname(target))
      await writeFile(target, data, { flag: 'wx' })
      manifest.bytes += data.length
      manifest.files.push({ path: destination, bytes: data.length, truncated: truncated || capped,
        sha256: createHash('sha256').update(data).digest('hex') })
    } catch (error) { if (error.code !== 'ENOENT') warning(destination, error) }
  }
  let report
  try {
    const input = await boundedRead(resolve(reportPath))
    if (input.truncated) throw new Error('Report exceeds ownership-read limit')
    report = JSON.parse(input.text.replace(/^\uFEFF/u, ''))
    await copy(resolve(reportPath), 'report.json')
    await copy(resolve(reportPath) + '.previous.yml', 'previous-manifest.yml')
  } catch (error) { manifest.status = 'report_unavailable'; warning('report', error) }
  const seen = new Set()
  for (const scenario of Array.isArray(report?.scenarios) ? report.scenarios.slice(0, 16) : []) {
    try {
      const root = typeof scenario.evidence === 'string' ? resolve(scenario.evidence) : ''
      if (!appData || !root || !samePath(dirname(root), resolve(appData)) ||
          !/^kun-gui-upgrade-[a-z-]+-[A-Za-z0-9]+$/.test(basename(root))) throw new Error('Unowned scenario path rejected')
      if (seen.has(root)) continue
      seen.add(root)
      await assertPlainPath(root)
      const owner = await boundedRead(join(root, '.upgrade-acceptance-owner'), 4096)
      if (owner.truncated || !samePath(owner.text.trim(), root)) throw new Error('Scenario owner marker mismatch')
      const journal = JSON.parse((await boundedRead(join(root, 'scenario.json'))).text.replace(/^\uFEFF/u, ''))
      if (journal.evidence !== scenario.evidence || journal.name !== scenario.name) throw new Error('Scenario journal identity mismatch')
      const prefix = `scenario-${manifest.roots.length + 1}`
      manifest.roots.push({ prefix, name: sanitizeText(String(scenario.name)).slice(0, 80) })
      for (const name of ROOT_FILES) await copy(join(root, name), join(prefix, name))
      for (const member of ['installer-recovery', 'installer-recovery-snapshot',
        'desktop-profile', 'desktop-profile-snapshot']) {
        const directory = join(root, member)
        try {
          await assertPlainPath(directory)
          const entries = await boundedEntries(directory)
          for (const entry of entries.slice(0, MAX_FILES)) {
            const allowed = member.startsWith('installer-') ? /^[\w{}.-]+\.json$/.test(entry.name)
              : /^pending-update(?:-result)?\.json$/.test(entry.name)
            if (allowed && entry.isFile()) await copy(join(directory, entry.name), join(prefix, member, entry.name))
          }
          if (member.startsWith('desktop-')) {
            const logs = join(directory, 'logs')
            await assertPlainPath(logs)
            for (const entry of (await boundedEntries(logs))) {
              if (entry.isFile() && /^(?:kun|deepseek-gui)-[\w.-]+\.log$/.test(entry.name)) {
                await copy(join(logs, entry.name), join(prefix, member, 'logs', entry.name))
              }
            }
          }
        } catch (error) { if (error.code !== 'ENOENT') warning(`${prefix}/${member}`, error) }
      }
    } catch (error) { warning('scenario', error) }
  }
  const collection = JSON.stringify(manifest, null, 2) + '\n'
  if (Buffer.byteLength(collection) > MAX_FILE_BYTES) throw new Error('Collection metadata budget exceeded')
  await writeFile(join(output, 'collection.json'), collection, { flag: 'wx' })
  return manifest
}
if (require.main === module) {
  const flags = new Map()
  for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1])
  stageEvidence({ reportPath: flags.get('--report') || 'windows-cross-version.json',
    outputDirectory: flags.get('--output') || 'artifacts/windows-cross-version', appData: process.env.APPDATA })
    .then(result => console.log(`Staged ${result.files.length} bounded evidence files; ${result.warnings.length} warnings`))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { stageEvidence, sanitizeDiagnostic, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES }
