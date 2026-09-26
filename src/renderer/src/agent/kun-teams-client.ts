import type { AdeTeamOverview } from '@shared/ade-teams'
import { kunTeamByManagerPath, kunTeamQuestionAnswerPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * /v1/teams client surface (docs/ade/09 §9): team overview for Mission
 * Control expansion plus the user-side question answer (§6.4).
 */
export function createKunTeamsClient() {
  return {
    /** Roster + recent dispatches/questions; null when the thread owns no team. */
    async getTeamOverview(managerThreadId: string): Promise<AdeTeamOverview | null> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamByManagerPath(managerThreadId), 'GET'
      )
      if (response.status === 404) return null
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to load team overview')
        )
      }
      return readRuntimeJson<AdeTeamOverview>(
        response.body, 'runtime returned an invalid response'
      )
    },

    /** User answers a worker question (answeredBy: 'user'). */
    async answerTeamQuestion(questionId: string, answer: string): Promise<void> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamQuestionAnswerPath(questionId),
        'POST',
        JSON.stringify({ answer })
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to answer worker question')
        )
      }
    }
  }
}
