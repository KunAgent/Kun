import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const RECOVERY_FILES = ['messages.jsonl', 'metadata.jsonl', 'events.jsonl', 'session.json'] as const
const RecoveryFileName = z.enum(RECOVERY_FILES)

const RecoveryManifest = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().min(1),
  threadId: z.string().min(1),
  files: z.array(z.object({
    name: RecoveryFileName,
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict())
}).strict()
type RecoveryManifest = z.infer<typeof RecoveryManifest>

/** External recovery copy used only when Tier-2 deletes the source directory. */
export class ConsolidationRecoveryStore {
  constructor(private readonly dataDir: string) {}

  async capture(input: { jobId: string; threadId: string }): Promise<string> {
    const sourceDir = join(this.dataDir, 'threads', input.threadId)
    const targetDir = join(this.dataDir, 'consolidation-recovery', input.jobId)
    const stagingDir = `${targetDir}.staging`
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true, mode: 0o700 })
    try {
      const files: RecoveryManifest['files'] = []
      for (const name of RECOVERY_FILES) {
        const source = join(sourceDir, name)
        const info = await stat(source).catch(() => null)
        if (!info) continue
        const destination = join(stagingDir, name)
        await copyFile(source, destination)
        files.push({
          name,
          bytes: info.size,
          sha256: createHash('sha256').update(await readFile(destination)).digest('hex')
        })
      }
      const manifest: RecoveryManifest = {
        schemaVersion: 1,
        jobId: input.jobId,
        threadId: input.threadId,
        files
      }
      await writeFile(join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      await rm(targetDir, { recursive: true, force: true })
      // The staging directory is only considered recoverable after its
      // manifest has been fully written. The rename is intentionally avoided
      // here because Windows cannot replace an existing directory atomically.
      await mkdir(targetDir, { recursive: true, mode: 0o700 })
      for (const name of [...files.map((file) => file.name), 'manifest.json']) {
        await copyFile(join(stagingDir, name), join(targetDir, name))
      }
      await rm(stagingDir, { recursive: true, force: true })
      return input.jobId
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async verify(jobId: string, threadId: string): Promise<boolean> {
    const dir = join(this.dataDir, 'consolidation-recovery', jobId)
    const raw = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => null)
    if (!raw) return false
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return false
    }
    const parsed = RecoveryManifest.safeParse(value)
    if (!parsed.success || parsed.data.jobId !== jobId || parsed.data.threadId !== threadId) return false
    for (const file of parsed.data.files) {
      const content = await readFile(join(dir, file.name)).catch(() => null)
      if (!content || content.length !== file.bytes ||
        createHash('sha256').update(content).digest('hex') !== file.sha256) return false
    }
    return true
  }

  async remove(jobId: string): Promise<void> {
    await rm(join(this.dataDir, 'consolidation-recovery', jobId), { recursive: true, force: true })
  }

  async list(): Promise<string[]> {
    const root = join(this.dataDir, 'consolidation-recovery')
    return (await readdir(root, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.staging'))
      .map((entry) => entry.name)
  }
}
