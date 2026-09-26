import {
  QuestionFileSchema,
  type QuestionRecord
} from '../contracts/ade.js'
import { adeQuestionsFile } from './ade-paths.js'
import { readAdeJson, withAdeTeamMutex, writeAdeJson } from './ade-file.js'

type QuestionState = QuestionRecord['state']

/** Terminal question states have no outgoing transitions. */
const TERMINAL: ReadonlySet<QuestionState> = new Set(['answered', 'timeout', 'cancelled'])

export class FileQuestionStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async create(teamId: string, record: QuestionRecord): Promise<QuestionRecord> {
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      if (!file.questions.some((entry) => entry.questionId === record.questionId)) {
        file.questions.push(record)
        await this.writeFile(teamId, file.questions)
      }
      return record
    })
  }

  async get(teamId: string, questionId: string): Promise<QuestionRecord | null> {
    const file = await this.readFile(teamId)
    return file.questions.find((entry) => entry.questionId === questionId) ?? null
  }

  async listByWorker(teamId: string, workerId: string): Promise<QuestionRecord[]> {
    const file = await this.readFile(teamId)
    return file.questions
      .filter((entry) => entry.workerId === workerId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /** All questions oldest-first (Mission Control / team overview). */
  async list(teamId: string): Promise<QuestionRecord[]> {
    const file = await this.readFile(teamId)
    return [...file.questions]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async listOpen(teamId: string): Promise<QuestionRecord[]> {
    const file = await this.readFile(teamId)
    return file.questions
      .filter((entry) => entry.state === 'open' || entry.state === 'escalated')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async update(
    teamId: string,
    questionId: string,
    patch: Partial<Pick<QuestionRecord, 'state' | 'answer' | 'answeredBy' | 'deadline'>>
  ): Promise<QuestionRecord | null> {
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      const index = file.questions.findIndex((entry) => entry.questionId === questionId)
      if (index < 0) return null
      const current = file.questions[index]
      if (TERMINAL.has(current.state) && patch.state !== undefined && patch.state !== current.state) {
        throw new Error(`invalid question transition ${current.state} -> ${patch.state}`)
      }
      const next: QuestionRecord = { ...current, ...patch, updatedAt: this.nowIso() }
      file.questions[index] = next
      await this.writeFile(teamId, file.questions)
      return next
    })
  }

  /**
   * Startup reconciliation: still-open questions can never be answered after
   * a restart (the waiting worker turn is gone), so mark them `timeout`.
   */
  async markOpenTimedOut(teamId: string): Promise<number> {
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      const now = this.nowIso()
      let count = 0
      for (const entry of file.questions) {
        if (entry.state === 'open' || entry.state === 'escalated') {
          entry.state = 'timeout'
          entry.updatedAt = now
          count += 1
        }
      }
      if (count > 0) await this.writeFile(teamId, file.questions)
      return count
    })
  }

  private async readFile(teamId: string): Promise<{ questions: QuestionRecord[] }> {
    const file = await readAdeJson(
      adeQuestionsFile(this.dataDir, teamId),
      QuestionFileSchema,
      () => ({ version: 1 as const, questions: [] as QuestionRecord[] })
    )
    return { questions: [...file.questions] }
  }

  private async writeFile(teamId: string, questions: QuestionRecord[]): Promise<void> {
    await writeAdeJson(adeQuestionsFile(this.dataDir, teamId), { version: 1, questions })
  }
}
