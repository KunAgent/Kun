import { productCaptureEpoch } from './client'
import { beginWorkSubmission, bindWorkAnalyticsTurn, observeWorkSubmission } from './work'

export type WorkSubmissionIntent = { epoch?: string }
export const captureWorkSubmissionIntent = (): WorkSubmissionIntent => ({ epoch: productCaptureEpoch() })

/** Wrap only an explicit user entry. Background/automatic sends never call this. */
export async function sendExplicitWorkMessage(send: (clientRequestId?: string) => Promise<boolean>,
  intent = captureWorkSubmissionIntent()): Promise<boolean> {
  const submission = beginWorkSubmission(intent)
  let accepted = false
  await observeWorkSubmission(submission, async () => {
    accepted = await send(submission?.clientRequestId)
    return accepted ? 'accepted' : 'failed'
  })
  return accepted
}

/** Direct provider entries preserve their response and original thrown error.
 * An intent captured at the click fences asynchronous document preparation. */
export async function submitExplicitWorkRequest<T extends { turnId: string }>(threadId: string,
  send: (clientRequestId?: string) => Promise<T>, outcomeMayBeUnknown: (error: unknown) => boolean,
  intent = captureWorkSubmissionIntent()): Promise<T> {
  const submission = beginWorkSubmission(intent)
  try {
    const accepted = await send(submission?.clientRequestId)
    if (submission) {
      bindWorkAnalyticsTurn(submission.clientRequestId, threadId, accepted.turnId)
      submission.finish('accepted')
    }
    return accepted
  } catch (error) {
    submission?.finish(outcomeMayBeUnknown(error) ? 'unknown' : 'failed')
    throw error
  }
}
