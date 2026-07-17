import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { LocalCollaborationSnapshotSchema, type LocalCollaborationSnapshot } from '../../shared/collaboration/contracts'

export class LocalCollaborationStore {
  private readonly filePath: string
  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'collaboration', 'local-workbench.json')
  }

  async load(): Promise<LocalCollaborationSnapshot> {
    try {
      return LocalCollaborationSnapshotSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { version: 1, meetings: [], employees: [], invocations: [], commandResults: {} }
    }
  }

  async save(snapshot: LocalCollaborationSnapshot): Promise<void> {
    const validated = LocalCollaborationSnapshotSchema.parse(snapshot)
    const dir = join(this.filePath, '..')
    await mkdir(dir, { recursive: true })
    const temp = `${this.filePath}.tmp.${randomBytes(4).toString('hex')}`
    await writeFile(temp, JSON.stringify(validated, null, 2), 'utf8')
    await rename(temp, this.filePath)
  }
}
