export const REMOTE_NO_EFFECT_CODES = [
  'REVISION_CONFLICT', 'MODEL_NOT_AVAILABLE', 'AGENT_NOT_AVAILABLE',
  'ATTACHMENT_NOT_CONFIRMED', 'NOT_FOUND', 'TASK_BUSY', 'INVALID_REQUEST', 'NOT_A_CODE_TASK'
] as const
export type RemoteNoEffectCode = typeof REMOTE_NO_EFFECT_CODES[number]
/** Only code paths that prove no persistent mutation may construct this error. */
export class RemoteNoEffect extends Error {
  constructor(readonly code: RemoteNoEffectCode) {
    super(code)
    if (!REMOTE_NO_EFFECT_CODES.includes(code)) throw new Error('INVALID_REMOTE_REJECTION')
  }
}
