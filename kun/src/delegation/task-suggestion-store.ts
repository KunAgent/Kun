import { resolve } from 'node:path'
import {
  TaskSuggestionFileSchema,
  type TaskSuggestionIntent,
  type TaskSuggestionFile
} from '../contracts/task-suggestions.js'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

export interface TaskSuggestionStore {
  list(threadId?: string): Promise<TaskSuggestionIntent[]>
  get(intentId: string): Promise<TaskSuggestionIntent | null>
  transaction<T>(mutate: (file: TaskSuggestionFile) => T | Promise<T>): Promise<T>
}

/** AtomicJsonFile routes canonical writes to Manager; no local mirror exists. */
export class FileTaskSuggestionStore implements TaskSuggestionStore {
  readonly path: string
  private readonly file: AtomicJsonFile<TaskSuggestionFile>

  constructor(dataDir: string) {
    this.path = resolve(dataDir, 'task-suggestions', 'intents.json')
    assertManagerAtomicJsonPath(this.path)
    this.file = new AtomicJsonFile(this.path, (value) => TaskSuggestionFileSchema.parse(value), false,
      { cacheManagerReads: true })
  }

  async list(threadId?: string): Promise<TaskSuggestionIntent[]> {
    const file = await this.file.read(emptyFile)
    return file.intents.filter((intent) => !threadId || intent.source.threadId === threadId)
      .map((intent) => structuredClone(intent))
  }

  async get(intentId: string): Promise<TaskSuggestionIntent | null> {
    const file = await this.file.read(emptyFile)
    const intent = file.intents.find((entry) => entry.intentId === intentId)
    return intent ? structuredClone(intent) : null
  }

  async transaction<T>(mutate: (file: TaskSuggestionFile) => T | Promise<T>): Promise<T> {
    return withManagerDataMutex(this.path, async (context) => {
      const file = structuredClone(await this.file.read(emptyFile))
      const before = JSON.stringify(file)
      const result = await mutate(file)
      const validated = TaskSuggestionFileSchema.parse(file)
      if (JSON.stringify(validated) !== before) {
        await context.assertCurrent()
        await context.withCommit(() => this.file.write(validated))
      }
      return structuredClone(result)
    })
  }
}

function emptyFile(): TaskSuggestionFile { return { version: 1, intents: [] } }

/** Process-local store for tests and runtimes without a data directory. */
export class InMemoryTaskSuggestionStore implements TaskSuggestionStore {
  private file: TaskSuggestionFile = emptyFile()
  private queue: Promise<unknown> = Promise.resolve()

  async list(threadId?: string): Promise<TaskSuggestionIntent[]> {
    return this.file.intents.filter((intent) => !threadId || intent.source.threadId === threadId)
      .map((intent) => structuredClone(intent))
  }

  async get(intentId: string): Promise<TaskSuggestionIntent | null> {
    const intent = this.file.intents.find((entry) => entry.intentId === intentId)
    return intent ? structuredClone(intent) : null
  }

  transaction<T>(mutate: (file: TaskSuggestionFile) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const file = structuredClone(this.file)
      const result = await mutate(file)
      this.file = TaskSuggestionFileSchema.parse(file)
      return structuredClone(result)
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}
