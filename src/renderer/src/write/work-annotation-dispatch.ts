import i18n from '../i18n'
import type { WorkAnnotation, WorkAnnotationMessage } from '@shared/work-annotations'
import { mutateAnnotation } from './work-annotation-storage'
import { notifyAnnotationChange } from './work-annotation-subscriptions'
import {
  AnnotationTurnFailed, annotationRoute, createAnnotationThread, findAnnotationTurn, freezeAnnotationSource,
  parseAnnotationAnswer, readAnnotationAnswer, startAnnotationTurn
} from './work-annotation-runtime'

const running = new Set<string>()

function required(record?: WorkAnnotation): WorkAnnotation {
  if (!record) throw new Error('This annotation no longer exists.')
  return record
}

/** All asynchronous completions are fenced by the locally admitted request ID. */
async function run(id: string, requestId: string, recoverOnly: boolean): Promise<void> {
  let record = await mutateAnnotation(id, required)
  const find = (row: WorkAnnotation) => row.messages.find((msg) => msg.request?.id === requestId && msg.status === 'pending')
  let message = find(record)
  if (!message?.request) return

  const update = async (patch: Partial<WorkAnnotationMessage>, threadId?: string): Promise<void> => {
    record = await mutateAnnotation(id, (old) => {
      const row = required(old)
      const target = find(row)
      if (!target) return row
      return {
        ...row, ...(threadId ? { threadId } : {}), updatedAt: new Date().toISOString(),
        messages: row.messages.map((msg) => msg === target ? { ...msg, ...patch } : msg)
      }
    })
    notifyAnnotationChange(record)
  }

  try {
    const request = { ...message.request }
    if (recoverOnly && !request.turnId) {
      const accepted = record.threadId && await findAnnotationTurn(record.threadId, request.id)
      if (!accepted) throw new Error(i18n.t('common:writeAnnotationInterrupted'))
      request.turnId = accepted
      await update({ request })
    }
    if (!request.turnId) {
      const route = request.route ?? await annotationRoute()
      request.source ??= freezeAnnotationSource(record, message)
      const threadId = record.threadId ?? await createAnnotationThread(record, route)
      request.route = route
      // Save thread, route and admission key before dispatch, so a lost HTTP response
      // can be retried against precisely the same target and frozen request.
      await update({ request }, threadId)
      message = find(record)
      if (!message) return
      request.turnId = await startAnnotationTurn(record, message, route)
      await update({ request })
    }
    const raw = await readAnnotationAnswer(record.threadId!, request.turnId)
    await update({ ...parseAnnotationAnswer(raw, request.anchor), status: undefined, error: undefined, request: undefined })
  } catch (error) {
    const pending = find(record)
    if (!pending?.request) return
    await update({
      status: 'failed', error: error instanceof Error ? error.message : String(error),
      request: { ...pending.request, ...(error instanceof AnnotationTurnFailed ? { terminal: true } : {}) }
    })
  }
}

export function dispatchAnnotation(id: string, requestId: string, recoverOnly = false): void {
  const key = 'kun-work-annotation:' + requestId
  if (running.has(key)) return
  running.add(key)
  const work = () => run(id, requestId, recoverOnly)
  const task = globalThis.navigator?.locks ? navigator.locks.request(key, work) : work()
  // An IndexedDB failure is also surfaced by the next list/read. Never dispatch
  // again automatically solely because persistence failed.
  void task.catch((error: unknown) => console.error('Work annotation delivery failed', error))
    .finally(() => running.delete(key))
}
