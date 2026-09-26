import type {
  AdeRaceComparison,
  AdeRunWorkerChecksResult,
  AdeTeamOverview,
  AdeTeamRecord,
  AdeTeamWorker
} from '@shared/ade-teams'
import {
  kunTeamByManagerPath,
  kunTeamQuestionAnswerPath,
  kunTeamRaceActionPath,
  kunTeamRacePath,
  kunTeamWorkerActionPath,
  kunTeamWorkerPath
} from '@shared/kun-endpoints'
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
    },

    /** Worker + owning team; null when the thread is not an ADE worker. */
    async getTeamWorker(
      workerId: string
    ): Promise<{ team: AdeTeamRecord; worker: AdeTeamWorker } | null> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamWorkerPath(workerId), 'GET'
      )
      if (response.status === 404) return null
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to load worker record')
        )
      }
      return readRuntimeJson<{ team: AdeTeamRecord; worker: AdeTeamWorker }>(
        response.body, 'runtime returned an invalid response'
      )
    },

    /** Worker control actions (09 §9): take-over, hand-back, stop, detach. */
    async controlTeamWorker(
      workerId: string,
      action: 'take-over' | 'hand-back' | 'stop' | 'detach'
    ): Promise<void> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamWorkerActionPath(workerId, action), 'POST', '{}'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, `failed to ${action} worker`)
        )
      }
    },

    /** Race record + per-contender compare data (10 §6.3, 11 §5). */
    async getRaceComparison(raceId: string): Promise<AdeRaceComparison> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamRacePath(raceId), 'GET'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to load race')
        )
      }
      return readRuntimeJson<AdeRaceComparison>(
        response.body, 'runtime returned an invalid response'
      )
    },

    /** User picks the winning dispatch (10 §6.4). */
    async decideRace(raceId: string, winnerDispatchId: string): Promise<void> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamRaceActionPath(raceId, 'decide'),
        'POST',
        JSON.stringify({ winnerDispatchId })
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to decide race')
        )
      }
    },

    /** Discards every non-winner task workspace (10 §6.5). */
    async discardRaceOthers(raceId: string): Promise<void> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamRaceActionPath(raceId, 'discard-others'),
        'POST',
        JSON.stringify({ confirm: true })
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to discard race workspaces')
        )
      }
    },

    /** Host check commands against the worker's task workspace (10 §4.2). */
    async runTeamWorkerChecks(workerId: string): Promise<AdeRunWorkerChecksResult> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTeamWorkerActionPath(workerId, 'run-checks'), 'POST', '{}'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to run checks')
        )
      }
      return readRuntimeJson<AdeRunWorkerChecksResult>(
        response.body, 'runtime returned an invalid response'
      )
    }
  }
}
