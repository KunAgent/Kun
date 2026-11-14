import { appendFileSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function lifecycleParticipant(root, role, withChild = false) {
  await mkdir(root, { recursive: true })
  const record = (event, detail = {}) => appendFileSync(join(root, 'trace.jsonl'),
    JSON.stringify({ event, role, pid: process.pid, at: Date.now(), ...detail }) + '\n')
  const server = createServer((_request, response) => response.end(role))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const child = withChild ? spawn(process.execPath, [fileURLToPath(import.meta.url), root, role + '-child'],
    { stdio: 'ignore' }) : undefined
  const ready = { role, pid: process.pid, port: server.address().port, child: child?.pid }
  record('ready', ready)
  await writeFile(join(root, `${role}-${process.pid}.json`), JSON.stringify(ready))
  let closing
  const close = (reason) => {
    closing ??= (async () => {
      let managerAvailable = false
      try {
        const probe = JSON.parse(await readFile(join(root, 'manager-probe.json'), 'utf8'))
        const response = await fetch(probe.url + '/health', { signal: AbortSignal.timeout(500) })
        const health = await response.json()
        managerAvailable = response.ok && health.instanceId === probe.instanceId
      } catch { /* Keep the actual failure in the trace. */ }
      record('stopping', { reason, managerAvailable })
      child?.kill('SIGTERM')
      await new Promise(done => server.close(done))
      record('listener-closed')
      process.exit(0)
    })()
    return closing
  }
  process.on('SIGTERM', () => { void close('SIGTERM') })
  process.on('SIGINT', () => { void close('SIGINT') })
  process.once('exit', () => record('exit'))
  return { ...ready, close }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, role] = process.argv.slice(2)
  if (!root || !role) throw new Error('Expected a fixture root and role')
  await lifecycleParticipant(root, role, !role.endsWith('-child'))
}
