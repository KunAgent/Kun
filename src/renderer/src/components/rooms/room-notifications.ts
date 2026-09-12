import type { RoomIntegration } from '@shared/rooms-api'
import type { RoomTaskDetail } from './rooms-client'

export type RoomIntegrationSnapshot = RoomIntegration &
  Pick<RoomTaskDetail, 'approvals' | 'userInputs'>
export type RoomNotice = { key: string; threadId: string; body: string }
const ids = (values: Array<{ id: string }> | undefined) =>
  (values ?? [])
    .map((value) => value.id)
    .sort()
    .join(',')

export function taskRoomNotice(detail: RoomTaskDetail): RoomNotice | null {
  const task = detail.task
  if (
    ![
      'needs_input',
      'needs_approval',
      'recovery_required',
      'failed',
      'awaiting_acceptance'
    ].includes(task.status)
  )
    return null
  return {
    key: [
      'task',
      task.id,
      task.status,
      task.latestDeliveryId ?? task.requirementRevision,
      ids(detail.approvals),
      ids(detail.userInputs),
      ['failed', 'recovery_required'].includes(task.status)
        ? task.updatedAt
        : ''
    ].join(':'),
    threadId: detail.controlThreadId ?? task.executionThreadId,
    body: task.title + ': ' + task.latestProgress
  }
}

export function integrationRoomNotice(
  detail: RoomTaskDetail,
  integration: RoomIntegrationSnapshot,
  translate: (key: string) => string
): RoomNotice | null {
  const status = integration.approvals?.length
    ? 'needs_approval'
    : integration.userInputs?.length
      ? 'needs_input'
      : integration.status
  if (
    ![
      'needs_approval',
      'needs_input',
      'failed',
      'conflict',
      'recovery_required',
      'ready'
    ].includes(status)
  )
    return null
  return {
    key: [
      'integration',
      integration.id,
      status,
      integration.candidateSha ?? integration.sourceSha,
      integration.threadId ?? '',
      integration.turnId ?? '',
      ids(integration.approvals),
      ids(integration.userInputs)
    ].join(':'),
    threadId: integration.threadId ?? detail.task.executionThreadId,
    body: `${detail.task.title}: ${translate('roomsIntegration')} · ${translate('roomsState_' + status)}`
  }
}
