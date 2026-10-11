import { resolve } from 'node:path'
import {
  AgentDispatchIntentFileSchema,
  type AgentDispatchIntent,
  type AgentDispatchIntentFile
} from '../contracts/agent-dispatch-intents.js'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

export interface AgentDispatchIntentStore {
  list(threadId?: string): Promise<AgentDispatchIntent[]>
  get(intentId: string): Promise<AgentDispatchIntent | null>
  transaction<T>(mutate: (file: AgentDispatchIntentFile) => T | Promise<T>): Promise<T>
}

/** AtomicJsonFile routes canonical writes to Manager; no local mirror exists. */
export class FileAgentDispatchIntentStore implements AgentDispatchIntentStore {
  readonly path: string
  private readonly file: AtomicJsonFile<AgentDispatchIntentFile>

  constructor(dataDir: string) {
    this.path = resolve(dataDir, 'agent-dispatch', 'intents.json')
    assertManagerAtomicJsonPath(this.path)
    this.file = new AtomicJsonFile(this.path, (value) => AgentDispatchIntentFileSchema.parse(value), false)
  }

  async list(threadId?: string): Promise<AgentDispatchIntent[]> {
    const file = await this.file.read(emptyFile)
    return file.intents.filter((intent) => !threadId || intent.source.threadId === threadId)
      .map((intent) => structuredClone(intent))
  }

  async get(intentId: string): Promise<AgentDispatchIntent | null> {
    const file = await this.file.read(emptyFile)
    const intent = file.intents.find((entry) => entry.intentId === intentId)
    return intent ? structuredClone(intent) : null
  }

  async transaction<T>(mutate: (file: AgentDispatchIntentFile) => T | Promise<T>): Promise<T> {
    return withManagerDataMutex(this.path, async (context) => {
      const file = structuredClone(await this.file.read(emptyFile))
      const before = JSON.stringify(file)
      const result = await mutate(file)
      const validated = AgentDispatchIntentFileSchema.parse(file)
      if (JSON.stringify(validated) !== before) {
        await context.assertCurrent()
        await context.withCommit(() => this.file.write(validated))
      }
      return structuredClone(result)
    })
  }
}

function emptyFile(): AgentDispatchIntentFile { return { version: 1, intents: [] } }
