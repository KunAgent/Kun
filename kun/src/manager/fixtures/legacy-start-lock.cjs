// Frozen pre-native wx protocol fixture. Keep its reclaim and cleanup races:
// compatibility tests must exercise old behavior, not the repaired algorithm.
const { open, readFile, rm, stat } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = process.argv[2]
const mode = process.argv[3]
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const command = () => new Promise((resolve) => process.once('message', resolve))
const alive = (pid) => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
async function removeOwned(owner) {
  try { if (await readFile(path, 'utf8') === owner) await rm(path, { force: true }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
async function main() {
  if (mode === 'reclaimer') {
    const text = await readFile(path, 'utf8')
    if (text !== process.argv[4]) throw new Error('Unexpected legacy reclaim fixture')
    process.send('observed')
    await command()
    try { await rm(path, { force: true }); process.send('removed') }
    catch { process.send('protected') }
    return
  }
  const owner = JSON.stringify({ pid: process.pid, instanceId: randomUUID(), acquiredAt: new Date().toISOString() })
  for (let attempt = 0; attempt < 2000; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try {
        // Simulate killing the old client between wx and metadata publication.
        if (mode !== 'empty') await handle.writeFile(owner, 'utf8')
        process.send('entered')
        await command()
        process.send('leaving')
      } finally { await handle.close(); await removeOwned(mode === 'empty' ? '' : owner) }
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let stale = null
      try {
        const [text, details] = await Promise.all([readFile(path, 'utf8'), stat(path)])
        const parsed = JSON.parse(text)
        if (Number.isInteger(parsed.pid) && parsed.pid > 0) stale = alive(parsed.pid) ? null : text
        else stale = Date.now() - details.mtimeMs >= 30000 ? text : null
      } catch { /* old syntax-error behavior */ }
      if (stale !== null) { await removeOwned(stale).catch(() => undefined); continue }
      await delay(20)
    }
  }
  throw new Error('Legacy lock fixture timed out')
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
