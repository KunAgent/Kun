import type { AnalyticsInput } from '@shared/product-analytics'
import { workRequestEpoch, workRunKeySource } from '@shared/product-analytics'
import { analyticsRunKey, productCaptureEpoch, trackProduct } from './client'

type WorkAction = 'copy' | 'export' | 'save'
type SubmissionOutcome = 'accepted' | 'failed' | 'unknown'
type WorkSubmission = { clientRequestId: string; finish: (outcome: SubmissionOutcome) => void }
type WorkObservation = {
  epoch: string
  started: number
  runKey: Promise<string>
  finished: boolean
  feedback: boolean
  presented: boolean
  completed: boolean
}
const requests = new Map<string, WorkObservation>()
const turns = new Map<string, WorkObservation>()
const completedTurns = new Map<string, string>()
const admissionListeners = new Set<() => void>()
const turnKey = (threadId: string, turnId: string) => JSON.stringify([threadId, turnId])
const boundedDuration = (started: number) => Math.max(0, Math.min(86_400_000, Date.now() - started))
function keep<K, V>(map: Map<K, V>, key: K, value: V) {
  map.set(key, value)
  if (map.size > 512) map.delete(map.keys().next().value!)
}
function emit(observation: WorkObservation, event: AnalyticsInput) {
  void observation.runKey.then(runKey => {
    if (productCaptureEpoch() === observation.epoch) {
      trackProduct({ ...event, properties: { ...event.properties, mode: 'work', runKey } })
    }
  }).catch(() => {})
}
export function clearWorkAnalytics(): void { requests.clear(); turns.clear(); completedTurns.clear() }
export function subscribeWorkAdmission(listener: () => void): () => void {
  admissionListeners.add(listener)
  return () => { admissionListeners.delete(listener) }
}

/** Only a new explicit user submission gets a marker; retries reuse its existing request id. */
export function beginWorkSubmission(): WorkSubmission | undefined {
  const epoch = productCaptureEpoch()
  if (!epoch) return
  try {
    const clientRequestId = `turn_work_${epoch}_${crypto.randomUUID()}`
    const observation: WorkObservation = {
      epoch, started: Date.now(), runKey: analyticsRunKey(workRunKeySource(clientRequestId)),
      finished: false, feedback: false, presented: false, completed: false
    }
    keep(requests, clientRequestId, observation)
    emit(observation, { name: 'work_task_submitted', properties: { mode: 'work' } })
    return { clientRequestId, finish(outcome) {
      if (observation.finished) return
      observation.finished = true
      emit(observation, { name: 'work_submission_finished', properties: {
        mode: 'work', requestOutcome: outcome, durationMs: boundedDuration(observation.started)
      } })
    } }
  } catch { return undefined }
}

export async function observeWorkSubmission(submission: WorkSubmission | undefined,
  send: () => Promise<SubmissionOutcome | void>): Promise<void> {
  try { const outcome = await send(); submission?.finish(outcome ?? 'failed') }
  catch (error) { submission?.finish('unknown'); throw error }
}

/** Admission callbacks carry the actual thread/turn, even after navigation or a queue delay. */
export function bindWorkAnalyticsTurn(clientRequestId: string, threadId: string, turnId: string): void {
  const observation = requests.get(clientRequestId)
  if (!threadId || !turnId || !observation || productCaptureEpoch() !== observation.epoch ||
    workRequestEpoch(clientRequestId) !== observation.epoch) return
  keep(turns, turnKey(threadId, turnId), observation)
  observation.completed = completedTurns.get(turnKey(threadId, turnId)) === observation.epoch
  for (const listener of admissionListeners) { try { listener() } catch { /* UI observers are optional. */ } }
}

function observedTurn(threadId: string, turnId?: string): WorkObservation | undefined {
  if (!turnId) return
  const observation = turns.get(turnKey(threadId, turnId))
  return observation?.epoch === productCaptureEpoch() ? observation : undefined
}

/** A completed terminal may arrive over SSE before its HTTP admission response. */
export function noteWorkTurnCompleted(threadId: string, turnId: string): void {
  const epoch = productCaptureEpoch()
  if (!epoch || !threadId || !turnId) return
  keep(completedTurns, turnKey(threadId, turnId), epoch)
  const observation = observedTurn(threadId, turnId)
  if (!observation || observation.completed) return
  observation.completed = true
  for (const listener of admissionListeners) { try { listener() } catch { /* Optional visibility observer. */ } }
}

/** Called only after a live submitted turn's actual timeline element becomes visible. */
export function noteWorkVisibleFeedback(threadId: string, turnId: string | undefined,
  feedbackKind: 'text' | 'reasoning' | 'tool', finalResult = false): void {
  const observation = observedTurn(threadId, turnId)
  if (!observation) return
  if (!observation.feedback) {
    observation.feedback = true
    emit(observation, { name: 'work_feedback_presented', properties: {
      mode: 'work', feedbackKind, durationMs: boundedDuration(observation.started)
    } })
  }
  if (finalResult && observation.completed && !observation.presented) {
    observation.presented = true
    emit(observation, { name: 'result_presented', properties: { mode: 'work', outputPresent: true } })
  }
}

/** Capture identity and attribution at the click, before an async clipboard or save dialog. */
export function captureWorkResultAction(threadId: string, turnId: string | undefined, action: WorkAction): () => void {
  const observation = observedTurn(threadId, turnId)
  if (!observation?.presented) return () => {}
  return () => {
    emit(observation, { name: 'result_action', properties: { mode: 'work', action } })
  }
}

/** Document actions are useful signals, without claiming that an AI result was adopted. */
export function captureWorkDocumentAction(action: WorkAction): () => void {
  const epoch = productCaptureEpoch()
  return () => {
    if (epoch && productCaptureEpoch() === epoch) trackProduct({ name: 'work_document_action', properties: { mode: 'work', action } })
  }
}

/** Only explicit Save buttons/shortcuts use this; autosave and pre-send flushes do not. */
export async function saveWorkDocumentExplicitly(save: () => Promise<boolean>): Promise<boolean> {
  const saved = captureWorkDocumentAction('save')
  const ok = await save()
  if (ok) saved()
  return ok
}
