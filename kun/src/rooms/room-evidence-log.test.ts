import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveBackgroundShellOutputPaths } from '../services/background-shell-output.js'
import { InMemoryArtifactStore } from '../artifacts/artifact-store.js'
import { preserveRoomLog, readRoomLog } from './room-evidence-log.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-room-logs-'))
  roots.push(dataDir)
  return { dataDir }
}
describe('durable room verification output', () => {
  it('retains complete output after source cleanup and pages UTF-8 without splitting characters', async () => {
    const deps = await fixture()
    const paths = resolveBackgroundShellOutputPaths(deps.dataDir, 'thread', 'session1234')
    await mkdir(paths.outputDir, { recursive: true })
    const source = paths.outputFilePath
    const contents = '回归通过 ✅ /src/文件.ts\n'.repeat(5000)
    await writeFile(source, contents)
    const log = await preserveRoomLog(deps, 'artifact', 'call', { output_file: source, session_id: 'session1234', output: 'short excerpt', output_truncated: true }, { nativeTool: true, threadId: 'thread' })
    await rm(source)
    let offset: number | undefined
    let text = ''
    do {
      const page = await readRoomLog(deps, log, offset)
      text += page.text
      offset = page.nextCursor
    } while (offset !== undefined)
    expect(text).toBe(contents)
    expect(log.truncated).toBe(false)
  })
  it('archives production output through the canonical artifact store and retains its owner', async () => {
    const local = await fixture()
    const artifacts = new InMemoryArtifactStore()
    const deps = { ...local, artifacts }
    const contents = '原始输出 ✅\n'.repeat(10000)
    const log = await preserveRoomLog(deps, 'verification', 'call', { output: contents })
    expect(log.file).toBeUndefined()
    expect(log.artifactId).toMatch(/^art_/)
    expect((await artifacts.stat(log.artifactId!))?.linkedOwners).toContain('rooms:verification')
    let offset: number | undefined
    let text = ''
    do { const page = await readRoomLog(deps, log, offset); text += page.text; offset = page.nextCursor } while (offset !== undefined)
    expect(text).toBe(contents)
  })
  it('preserves an excerpt when full output is unavailable and rejects foreign paths and symlink escapes', async () => {
    const deps = await fixture()
    const outside = await fixture()
    const foreign = join(outside.dataDir, 'private.log')
    await writeFile(foreign, 'Do not expose this file')
    const excerpt = await preserveRoomLog(deps, 'excerpt', 'call', { output_file: foreign, output: 'Retained output' })
    expect((await readRoomLog(deps, excerpt)).text).toBe('Retained output')
    expect(excerpt.truncated).toBe(true)
    await expect(readRoomLog(deps, { ...excerpt, file: '../../private.log' })).rejects.toThrow('reference')
    const dir = join(deps.dataDir, 'rooms', 'evidence')
    await mkdir(dir, { recursive: true })
    const escaped = 'a'.repeat(64) + '.log'
    await symlink(foreign, join(dir, escaped))
    await expect(readRoomLog(deps, { file: escaped, bytes: 0, truncated: false })).rejects.toThrow('escaped')
  })
})
